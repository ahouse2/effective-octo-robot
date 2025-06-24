import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import OpenAI from 'https://esm.sh/openai@4.52.7';
import { GoogleGenerativeAI } from 'https://esm.sh/@google/generative-ai@0.15.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Helper function to extract JSON from markdown code blocks
function extractJsonFromMarkdown(text: string): any | null {
  const jsonBlockRegex = /```json\n([\s\S]*?)\n```/;
  const match = text.match(jsonBlockRegex);
  if (match && match[1]) {
    try {
      return JSON.parse(match[1]);
    } catch (e) {
      console.error("Failed to parse JSON from markdown:", e);
      return null;
    }
  }
  return null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { caseId, command, payload } = await req.json();
    const userId = req.headers.get('x-supabase-user-id');

    if (!caseId || !userId || !command || !payload) {
      return new Response(JSON.stringify({ error: 'caseId, userId, command, and payload are required' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      });
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          persistSession: false,
        },
      }
    );

    // Fetch case details to determine AI model and retrieve existing data
    const { data: caseData, error: caseError } = await supabaseClient
      .from('cases')
      .select('ai_model, openai_thread_id, openai_assistant_id, gemini_chat_history')
      .eq('id', caseId)
      .single();

    if (caseError || !caseData) {
      console.error('Error fetching case data:', caseError);
      throw new Error('Case not found or error fetching case details.');
    }

    const { ai_model, openai_thread_id, openai_assistant_id, gemini_chat_history } = caseData;

    let responseMessage = 'AI Orchestration initiated.';

    if (ai_model === 'openai') {
      if (!openai_thread_id || !openai_assistant_id) {
        throw new Error('OpenAI thread or assistant ID missing for this case.');
      }

      const openai = new OpenAI({
        apiKey: Deno.env.get('OPENAI_API_KEY'),
      });

      // Handle different commands for OpenAI
      if (command === 'user_prompt') {
        const { promptContent } = payload;
        console.log(`OpenAI: Processing user prompt for case ${caseId}: "${promptContent}"`);

        // Add user message to thread
        await openai.beta.threads.messages.create(
          openai_thread_id,
          {
            role: "user",
            content: promptContent,
          }
        );

        // Create a run to process the message
        const run = await openai.beta.threads.runs.create(
          openai_thread_id,
          {
            assistant_id: openai_assistant_id,
          }
        );

        // Poll for run completion and process messages
        let runStatus = run.status;
        while (runStatus === 'queued' || runStatus === 'in_progress' || runStatus === 'cancelling') {
          await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for 1 second
          const retrievedRun = await openai.beta.threads.runs.retrieve(
            openai_thread_id,
            run.id
          );
          runStatus = retrievedRun.status;
          console.log(`OpenAI Run Status: ${runStatus}`);

          if (runStatus === 'requires_action' && retrievedRun.required_action?.type === 'submit_tool_outputs') {
            // Handle tool calls if necessary (e.g., for file_search or web_search)
            // For now, we'll just log and acknowledge, a full tool implementation is complex.
            console.log('OpenAI requires tool action:', retrievedRun.required_action.submit_tool_outputs.tool_calls);
            await supabaseClient.from('agent_activities').insert({
              case_id: caseId,
              agent_name: 'OpenAI Assistant',
              agent_role: 'Tool Executor',
              activity_type: 'Tool Call Required',
              content: `OpenAI Assistant requested tool execution. This functionality needs to be implemented to proceed.`,
              status: 'processing',
            });
            // For a production system, you'd execute the tool and submit outputs:
            // await openai.beta.threads.runs.submitToolOutputs(openai_thread_id, run.id, { tool_outputs: [...] });
            // For now, we'll let it continue or potentially fail if tools are critical.
          }
        }

        if (runStatus === 'completed') {
          const messages = await openai.beta.threads.messages.list(openai_thread_id, { order: 'desc', limit: 1 });
          const latestMessage = messages.data[0];

          if (latestMessage && latestMessage.role === 'assistant') {
            const assistantResponse = latestMessage.content.map(block => {
              if (block.type === 'text') {
                return block.text.value;
              }
              return '';
            }).join('\n');

            // Attempt to parse structured data from the response
            const structuredData = extractJsonFromMarkdown(assistantResponse);

            if (structuredData) {
              if (structuredData.theory_update) {
                const { error: theoryUpdateError } = await supabaseClient
                  .from('case_theories')
                  .update({
                    fact_patterns: structuredData.theory_update.fact_patterns,
                    legal_arguments: structuredData.theory_update.legal_arguments,
                    potential_outcomes: structuredData.theory_update.potential_outcomes,
                    status: structuredData.theory_update.status,
                    last_updated: new Date().toISOString(),
                  })
                  .eq('case_id', caseId);
                if (theoryUpdateError) console.error('Error updating case theory:', theoryUpdateError);
              }
              if (structuredData.insights && Array.isArray(structuredData.insights)) {
                for (const insight of structuredData.insights) {
                  const { error: insightInsertError } = await supabaseClient
                    .from('case_insights')
                    .insert({
                      case_id: caseId,
                      title: insight.title,
                      description: insight.description,
                      insight_type: insight.insight_type || 'general',
                      timestamp: new Date().toISOString(),
                    });
                  if (insightInsertError) console.error('Error inserting case insight:', insightInsertError);
                }
              }
            }

            await supabaseClient.from('agent_activities').insert({
              case_id: caseId,
              agent_name: 'OpenAI Assistant',
              agent_role: 'AI',
              activity_type: 'Response',
              content: assistantResponse,
              status: 'completed',
            });
            responseMessage = 'OpenAI Assistant responded.';
          } else {
            await supabaseClient.from('agent_activities').insert({
              case_id: caseId,
              agent_name: 'OpenAI Assistant',
              agent_role: 'AI',
              activity_type: 'No Response',
              content: 'OpenAI Assistant completed run but provided no visible response.',
              status: 'completed',
            });
            responseMessage = 'OpenAI Assistant completed run but no response.';
          }
        } else {
          await supabaseClient.from('agent_activities').insert({
            case_id: caseId,
            agent_name: 'OpenAI Assistant',
            agent_role: 'Error Handler',
            activity_type: 'Run Failed',
            content: `OpenAI Assistant run failed or ended with status: ${runStatus}`,
            status: 'error',
          });
          throw new Error(`OpenAI Assistant run failed with status: ${runStatus}`);
        }

      } else if (command === 'process_additional_files') {
        const { newFileNames } = payload;
        console.log(`OpenAI: Processing additional files for case ${caseId}: ${newFileNames.join(', ')}`);

        const openaiFileIds: string[] = [];
        for (const fileName of newFileNames) {
          const filePath = `${userId}/${caseId}/${fileName}`;
          const { data: fileBlob, error: downloadError } = await supabaseClient.storage
            .from('evidence-files')
            .download(filePath);

          if (downloadError) {
            console.error(`Error downloading file ${fileName} from Supabase Storage:`, downloadError);
            await supabaseClient.from('agent_activities').insert({
              case_id: caseId,
              agent_name: 'File Processor',
              agent_role: 'Error Handler',
              activity_type: 'File Download Failed',
              content: `Failed to download ${fileName} from Supabase Storage: ${downloadError.message}`,
              status: 'error',
            });
            throw new Error(`Failed to download file ${fileName}.`);
          }

          if (fileBlob) {
            try {
              const openaiFile = await openai.files.create({
                file: new File([fileBlob], fileName),
                purpose: 'assistants',
              });
              openaiFileIds.push(openaiFile.id);
              await supabaseClient.from('agent_activities').insert({
                case_id: caseId,
                agent_name: 'File Processor',
                agent_role: 'OpenAI Integration',
                activity_type: 'File Uploaded to OpenAI',
                content: `Successfully uploaded ${fileName} to OpenAI (ID: ${openaiFile.id}).`,
                status: 'completed',
              });
            } catch (openaiUploadError: any) {
              console.error(`Error uploading file ${fileName} to OpenAI:`, openaiUploadError);
              await supabaseClient.from('agent_activities').insert({
                case_id: caseId,
                agent_name: 'File Processor',
                agent_role: 'Error Handler',
                activity_type: 'OpenAI File Upload Failed',
                content: `Failed to upload ${fileName} to OpenAI: ${openaiUploadError.message}`,
                status: 'error',
              });
              throw new Error(`Failed to upload file ${fileName} to OpenAI.`);
            }
          }
        }

        // Add a message to the thread about the new files
        await openai.beta.threads.messages.create(
          openai_thread_id,
          {
            role: "user",
            content: `New files have been uploaded for analysis: ${newFileNames.join(', ')}. Please incorporate them into your ongoing analysis.`,
            attachments: openaiFileIds.map(fileId => ({ file_id: fileId, tools: [{ type: "file_search" }] })),
          }
        );

        // Create a run to process the new files
        const run = await openai.beta.threads.runs.create(
          openai_thread_id,
          {
            assistant_id: openai_assistant_id,
          }
        );

        // Poll for run completion (similar to user_prompt)
        let runStatus = run.status;
        while (runStatus === 'queued' || runStatus === 'in_progress' || runStatus === 'cancelling') {
          await new Promise(resolve => setTimeout(resolve, 1000));
          const retrievedRun = await openai.beta.threads.runs.retrieve(
            openai_thread_id,
            run.id
          );
          runStatus = retrievedRun.status;
          console.log(`OpenAI Run Status (New Files): ${runStatus}`);
        }

        if (runStatus === 'completed') {
          await supabaseClient.from('agent_activities').insert({
            case_id: caseId,
            agent_name: 'OpenAI Assistant',
            agent_role: 'AI',
            activity_type: 'New Files Processed',
            content: 'OpenAI Assistant has processed the newly uploaded files.',
            status: 'completed',
          });
          responseMessage = 'OpenAI Assistant processed new files.';
        } else {
          await supabaseClient.from('agent_activities').insert({
            case_id: caseId,
            agent_name: 'OpenAI Assistant',
            agent_role: 'Error Handler',
            activity_type: 'New File Processing Failed',
            content: `OpenAI Assistant run for new files failed or ended with status: ${runStatus}`,
            status: 'error',
          });
          throw new Error(`OpenAI Assistant run for new files failed with status: ${runStatus}`);
        }
      } else {
        throw new Error(`Unsupported command for OpenAI: ${command}`);
      }

    } else if (ai_model === 'gemini') {
      const genAI = new GoogleGenerativeAI(Deno.env.get('GOOGLE_GEMINI_API_KEY') ?? '');
      const model = genAI.getGenerativeModel({ model: "gemini-pro" });

      // Initialize chat session with history if available
      const chat = model.startChat({
        history: gemini_chat_history || [],
        generationConfig: {
          maxOutputTokens: 2048,
        },
      });

      if (command === 'user_prompt') {
        const { promptContent } = payload;
        console.log(`Gemini: Processing user prompt for case ${caseId}: "${promptContent}"`);

        try {
          const result = await chat.sendMessage(promptContent);
          const response = await result.response;
          const text = response.text();

          // Update chat history in the database
          const updatedChatHistory = [...(gemini_chat_history || []),
            { role: 'user', parts: [{ text: promptContent }] },
            { role: 'model', parts: [{ text: text }] }
          ];
          await supabaseClient.from('cases').update({ gemini_chat_history: updatedChatHistory }).eq('id', caseId);

          // Attempt to parse structured data from the response
          const structuredData = extractJsonFromMarkdown(text);

          if (structuredData) {
            if (structuredData.theory_update) {
              const { error: theoryUpdateError } = await supabaseClient
                .from('case_theories')
                .update({
                  fact_patterns: structuredData.theory_update.fact_patterns,
                  legal_arguments: structuredData.theory_update.legal_arguments,
                  potential_outcomes: structuredData.theory_update.potential_outcomes,
                  status: structuredData.theory_update.status,
                  last_updated: new Date().toISOString(),
                })
                .eq('case_id', caseId);
              if (theoryUpdateError) console.error('Error updating case theory:', theoryUpdateError);
            }
            if (structuredData.insights && Array.isArray(structuredData.insights)) {
              for (const insight of structuredData.insights) {
                const { error: insightInsertError } = await supabaseClient
                  .from('case_insights')
                  .insert({
                    case_id: caseId,
                    title: insight.title,
                    description: insight.description,
                    insight_type: insight.insight_type || 'general',
                    timestamp: new Date().toISOString(),
                  });
                if (insightInsertError) console.error('Error inserting case insight:', insightInsertError);
              }
            }
          }

          await supabaseClient.from('agent_activities').insert({
            case_id: caseId,
            agent_name: 'Google Gemini',
            agent_role: 'AI',
            activity_type: 'Response',
            content: text,
            status: 'completed',
          });
          responseMessage = 'Google Gemini responded.';
        } catch (geminiError: any) {
          console.error('Error interacting with Gemini:', geminiError);
          await supabaseClient.from('agent_activities').insert({
            case_id: caseId,
            agent_name: 'Google Gemini',
            agent_role: 'Error Handler',
            activity_type: 'Gemini Interaction Failed',
            content: `Failed to get response from Gemini: ${geminiError.message}`,
            status: 'error',
          });
          throw new Error(`Failed to get response from Gemini: ${geminiError.message}`);
        }

      } else if (command === 'process_additional_files') {
        const { newFileNames } = payload;
        console.log(`Gemini: Processing additional files for case ${caseId}: ${newFileNames.join(', ')}`);

        // For Gemini, direct file analysis requires a RAG setup (e.g., embedding files and querying a vector store).
        // This is a placeholder to acknowledge the files and inform the user.
        const content = `New files (${newFileNames.join(', ')}) uploaded. For Google Gemini to analyze documents, a RAG (Retrieval Augmented Generation) setup with a vector store is required. This functionality is not yet fully integrated for Gemini.`;
        
        await supabaseClient.from('agent_activities').insert({
          case_id: caseId,
          agent_name: 'Google Gemini',
          agent_role: 'File Processor',
          activity_type: 'File Processing Note',
          content: content,
          status: 'completed',
        });

        // Also add this to chat history
        const updatedChatHistory = [...(gemini_chat_history || []),
          { role: 'model', parts: [{ text: content }] }
        ];
        await supabaseClient.from('cases').update({ gemini_chat_history: updatedChatHistory }).eq('id', caseId);

        responseMessage = 'Gemini noted new files, RAG setup required for analysis.';
      } else {
        throw new Error(`Unsupported command for Gemini: ${command}`);
      }

    } else {
      throw new Error(`Unsupported AI model: ${ai_model}`);
    }

    return new Response(JSON.stringify({ message: responseMessage, caseId }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error: any) {
    console.error('Edge Function error:', error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});