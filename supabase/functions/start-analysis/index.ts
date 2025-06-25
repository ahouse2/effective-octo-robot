import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import OpenAI from 'https://esm.sh/openai@4.52.7';
import { GoogleGenerativeAI } from 'https://esm.sh/@google/generative-ai@0.15.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Standardized helper to get user ID from either JWT (client-side) or custom header (server-side)
async function getUserIdFromRequest(req: Request, supabaseClient: SupabaseClient): Promise<string | null> {
  try {
    // 1. Try to get user from Authorization header (standard for client calls)
    const authHeader = req.headers.get('Authorization');
    if (authHeader) {
      const { data: { user }, error } = await supabaseClient.auth.getUser(authHeader.replace('Bearer ', ''));
      if (error) {
        console.warn("getUserIdFromRequest: Failed to get user from JWT:", error.message);
      }
      if (user) {
        return user.id;
      }
    }

    // 2. Fallback to custom header (for server-to-server calls)
    const userIdFromHeader = req.headers.get('x-supabase-user-id');
    if (userIdFromHeader) {
      return userIdFromHeader;
    }

    return null;
  } catch (e) {
    console.error("getUserIdFromRequest: Error getting user ID:", e);
    return null;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          persistSession: false,
        },
      }
    );
    
    const { caseId, fileNames, caseGoals, systemInstruction, aiModel, openaiAssistantId: clientProvidedAssistantId } = await req.json();
    const userId = await getUserIdFromRequest(req, supabaseClient);

    if (!caseId || !userId || !aiModel) {
      return new Response(JSON.stringify({ error: 'Case ID, User ID, and AI Model are required' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      });
    }

    // 1. Insert initial agent activity: Analysis initiated
    const { error: activityError } = await supabaseClient
      .from('agent_activities')
      .insert({
        case_id: caseId,
        agent_name: 'System Initiator',
        agent_role: 'Orchestrator',
        activity_type: 'Analysis Initiation',
        content: `Analysis initiated for case ${caseId} using ${aiModel.toUpperCase()}. Files received: ${fileNames.join(', ')}. Case Goals: ${caseGoals || 'Not specified'}. System Instruction: ${systemInstruction || 'None provided'}.`,
        status: 'processing',
      });

    if (activityError) {
      console.error('Error inserting initial activity:', activityError);
      throw new Error('Failed to insert initial agent activity.');
    }

    // 2. Insert initial case theory
    const { error: theoryError } = await supabaseClient
      .from('case_theories')
      .insert({
        case_id: caseId,
        fact_patterns: [],
        legal_arguments: [],
        potential_outcomes: [],
        status: 'initial',
      });

    if (theoryError) {
      console.error('Error inserting initial case theory:', theoryError);
      throw new Error('Failed to insert initial case theory.');
    }

    let insertedMetadata: any[] | null = null;
    // 3. Record file metadata and trigger categorization
    if (fileNames && fileNames.length > 0) {
      const fileMetadataInserts = fileNames.map((fileName: string) => ({
        case_id: caseId,
        file_name: fileName,
        file_path: `${userId}/${caseId}/${fileName}`,
        description: `Initial upload for case ${caseId}`,
      }));

      const { data, error: metadataError } = await supabaseClient
        .from('case_files_metadata')
        .insert(fileMetadataInserts)
        .select('id, file_name, file_path');
      
      insertedMetadata = data;

      if (metadataError) {
        console.error('Error inserting file metadata:', metadataError);
        await supabaseClient.from('agent_activities').insert({
          case_id: caseId,
          agent_name: 'System',
          agent_role: 'Database Error',
          activity_type: 'File Metadata Error',
          content: `Failed to record metadata for some files: ${metadataError.message}`,
          status: 'error',
        });
      } else if (insertedMetadata) {
        const categorizationPromises = insertedMetadata.map(meta =>
            supabaseClient.functions.invoke('file-categorizer', {
                body: JSON.stringify({
                    fileId: meta.id,
                    fileName: meta.file_name,
                    filePath: meta.file_path,
                }),
            })
        );
        const summarizationPromises = insertedMetadata.map(meta =>
            supabaseClient.functions.invoke('file-summarizer', {
                body: JSON.stringify({
                    fileId: meta.id,
                    fileName: meta.file_name,
                    filePath: meta.file_path,
                }),
            })
        );
        Promise.allSettled([...categorizationPromises, ...summarizationPromises]).then(results => {
            results.forEach(result => {
                if (result.status === 'rejected') {
                    console.error("A file processing task (categorization or summarization) failed:", result.reason);
                }
            });
        });
      }
    }

    let finalOpenAIAssistantId: string | undefined;
    let openaiThreadId: string | undefined;

    const structuredOutputInstruction = `
    When providing updates or summaries, especially after processing new information or a user prompt, please include structured JSON data within a markdown code block (e.g., \`\`\`json{...}\`\`\`). This JSON should contain updates to the case theory and/or new insights.

    **Case Theory Update Schema (optional, include if theory changes):**
    \`\`\`json
    {
      "theory_update": {
        "fact_patterns": ["Updated fact 1", "Updated fact 2"],
        "legal_arguments": ["Updated argument 1", "Updated argument 2"],
        "potential_outcomes": ["Updated outcome 1", "Updated outcome 2"],
        "status": "developing" | "refined" | "complete"
      }
    }
    \`\`\`

    **Case Insights Schema (optional, include if new insights are generated):**
    \`\`\`json
    {
      "insights": [
        {
          "title": "Insight Title",
          "description": "Detailed description of the insight.",
          "insight_type": "key_fact" | "risk_assessment" | "outcome_trend" | "general"
        },
        {
          "title": "Another Insight",
          "description": "More details.",
          "insight_type": "general"
        }
      ]
    }
    \`\`\`
    You can combine both "theory_update" and "insights" in a single JSON block if applicable.
    `;

    if (aiModel === 'openai') {
      const openai = new OpenAI({
        apiKey: Deno.env.get('OPENAI_API_KEY'),
      });

      // Upload files to OpenAI and update metadata
      const openaiFileAttachments: { file_id: string; tools: { type: string }[] }[] = [];
      if (insertedMetadata) {
        for (const meta of insertedMetadata) {
          const filePath = meta.file_path;
          const fileName = meta.file_name;
          
          const { data: fileBlob, error: downloadError } = await supabaseClient.storage
            .from('evidence-files')
            .download(filePath);

          if (downloadError) {
            console.error(`Error downloading file ${fileName} from Supabase Storage:`, downloadError);
            await supabaseClient.from('agent_activities').insert({
              case_id: caseId, agent_name: 'File Processor', agent_role: 'Error Handler',
              activity_type: 'File Download Failed', content: `Failed to download ${fileName} from Supabase Storage: ${downloadError.message}`, status: 'error',
            });
            continue; // Skip this file
          }

          if (fileBlob) {
            try {
              const openaiFile = await openai.files.create({
                file: new File([fileBlob], fileName),
                purpose: 'assistants',
              });
              openaiFileAttachments.push({ file_id: openaiFile.id, tools: [{ type: "file_search" }] });

              // Update the metadata row with the openai_file_id
              const { error: updateMetaError } = await supabaseClient
                .from('case_files_metadata')
                .update({ openai_file_id: openaiFile.id })
                .eq('id', meta.id);

              if (updateMetaError) {
                console.error(`Failed to update metadata for ${fileName} with OpenAI file ID:`, updateMetaError);
              }

              await supabaseClient.from('agent_activities').insert({
                case_id: caseId, agent_name: 'File Processor', agent_role: 'OpenAI Integration',
                activity_type: 'File Uploaded to OpenAI', content: `Successfully uploaded ${fileName} to OpenAI (ID: ${openaiFile.id}).`, status: 'completed',
              });
            } catch (openaiUploadError: any) {
              console.error(`Error uploading file ${fileName} to OpenAI:`, openaiUploadError);
              await supabaseClient.from('agent_activities').insert({
                case_id: caseId, agent_name: 'File Processor', agent_role: 'Error Handler',
                activity_type: 'OpenAI File Upload Failed', content: `Failed to upload ${fileName} to OpenAI: ${openaiUploadError.message}`, status: 'error',
              });
            }
          }
        }
      }

      // 4. Create or retrieve an OpenAI Assistant
      let assistant;
      let assistantToUseId = clientProvidedAssistantId; // Prioritize client-provided ID

      const assistantTools = [
        { type: "file_search" },
        {
          type: "function",
          function: {
            name: "web_search",
            description: "Perform a web search to get up-to-date information or external context.",
            parameters: {
              type: "object",
              properties: {
                query: {
                  type: "string",
                  description: "The search query.",
                },
              },
              required: ["query"],
            },
          },
        },
      ];

      if (assistantToUseId) {
        try {
          assistant = await openai.beta.assistants.retrieve(assistantToUseId);
          // Update assistant to ensure it has the latest tools and instructions
          assistant = await openai.beta.assistants.update(assistantToUseId, {
            instructions: `You are a specialized AI assistant for California family law cases. Your primary goal is to analyze evidence, identify key facts, legal arguments, and potential outcomes. You should be precise, objective, and focus on the legal implications of the provided documents. Always cite the source document when making claims.
            
            User's Case Goals: ${caseGoals || 'Not specified.'}
            User's System Instruction: ${systemInstruction || 'None provided.'}
            
            When responding, provide updates on your analysis progress, key findings, and any questions you have.
            ${structuredOutputInstruction}`,
            tools: assistantTools,
            model: "gpt-4o",
          });
          console.log('Using and updated existing OpenAI Assistant:', assistant.id);
          finalOpenAIAssistantId = assistant.id;
        } catch (retrieveError: any) {
          console.warn(`Failed to retrieve existing Assistant with ID ${assistantToUseId}: ${retrieveError.message}. Creating a new one.`);
          assistantToUseId = undefined; // Force creation of a new assistant
        }
      }

      if (!assistantToUseId) { // If no ID was provided or retrieval failed
        try {
          assistant = await openai.beta.assistants.create({
            name: "Family Law AI Assistant",
            instructions: `You are a specialized AI assistant for California family law cases. Your primary goal is to analyze evidence, identify key facts, legal arguments, and potential outcomes. You should be precise, objective, and focus on the legal implications of the provided documents. Always cite the source document when making claims.
            
            User's Case Goals: ${caseGoals || 'Not specified.'}
            User's System Instruction: ${systemInstruction || 'None provided.'}
            
            When responding, provide updates on your analysis progress, key findings, and any questions you have.
            ${structuredOutputInstruction}`,
            tools: assistantTools,
            model: "gpt-4o", // Or another suitable model like "gpt-4-turbo"
          });
          finalOpenAIAssistantId = assistant.id;
          console.log('Created new OpenAI Assistant:', assistant.id);
          await supabaseClient.from('agent_activities').insert({
            case_id: caseId,
            agent_name: 'OpenAI Setup',
            agent_role: 'Configuration',
            activity_type: 'Assistant Created',
            content: `New OpenAI Assistant created with ID: ${assistant.id}.`,
            status: 'completed',
          });
        } catch (createError: any) {
          console.error('Error creating OpenAI Assistant:', createError);
          await supabaseClient.from('agent_activities').insert({
            case_id: caseId,
            agent_name: 'OpenAI Setup',
            agent_role: 'Error Handler',
            activity_type: 'Assistant Creation Failed',
            content: `Failed to create OpenAI Assistant: ${createError.message}`,
            status: 'error',
          });
          throw new Error('Failed to create OpenAI Assistant.');
        }
      }

      // 5. Create a new thread
      const thread = await openai.beta.threads.create();
      console.log('Created new OpenAI Thread:', thread.id);
      openaiThreadId = thread.id;

      // 6. Add initial message to the thread with file references
      const initialMessageContent = `Please begin the analysis for the case. The primary case goals are: "${caseGoals || 'Not specified.'}". Additional system instructions: "${systemInstruction || 'None provided.'}". The uploaded files are now available for analysis.`;
      
      await openai.beta.threads.messages.create(
        thread.id,
        {
          role: "user",
          content: initialMessageContent,
          attachments: openaiFileAttachments,
        }
      );
      console.log('Added initial message and files to thread.');

      // 7. Create a run for the Assistant to process the initial message and files
      const run = await openai.beta.threads.runs.create(
        thread.id,
        {
          assistant_id: finalOpenAIAssistantId,
        }
      );
      console.log('Initiated OpenAI Run:', run.id);

      // 8. Update the cases table with OpenAI thread and assistant IDs
      const { error: updateCaseError } = await supabaseClient
        .from('cases')
        .update({
          openai_thread_id: openaiThreadId,
          openai_assistant_id: finalOpenAIAssistantId, // Save the actual assistant ID used
          status: 'In Progress', // Set status to In Progress as AI starts working
        })
        .eq('id', caseId);

      if (updateCaseError) {
        console.error('Error updating case with OpenAI IDs:', updateCaseError);
        throw new Error('Failed to update case with OpenAI IDs.');
      }

      await supabaseClient.from('agent_activities').insert({
        case_id: caseId,
        agent_name: 'OpenAI Integration',
        agent_role: 'Orchestrator',
        activity_type: 'AI Analysis Started',
        content: `OpenAI Assistant (ID: ${finalOpenAIAssistantId}) started analysis on Thread (ID: ${openaiThreadId}). Run ID: ${run.id}.`,
        status: 'processing',
      });

      return new Response(JSON.stringify({ message: 'AI analysis initiated successfully', caseId, threadId: openaiThreadId, runId: run.id }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });

    } else if (aiModel === 'gemini') {
      // For Gemini, we don't have a direct "Assistant" or "Thread" concept like OpenAI.
      // The interaction will be more direct via the model.generateContent or chat methods.
      // File analysis for Gemini typically requires a RAG setup (embeddings + vector store).
      // For initial setup, we'll just log that analysis is starting.

      // No need to upload files to Gemini directly here, as it's handled by RAG later.
      // Just acknowledge the files and inform the user about RAG requirement.

      await supabaseClient.from('agent_activities').insert({
        case_id: caseId,
        agent_name: 'Google Gemini Integration',
        agent_role: 'Orchestrator',
        activity_type: 'AI Analysis Started',
        content: `Google Gemini analysis initiated. Note: For full document analysis with Gemini, a RAG (Retrieval Augmented Generation) setup is required. Files (${fileNames.join(', ')}) are uploaded to storage but not directly to Gemini for analysis at this stage.`,
        status: 'processing',
      });

      // Update case status to In Progress
      const { error: updateCaseError } = await supabaseClient
        .from('cases')
        .update({
          status: 'In Progress',
          gemini_chat_history: [], // Initialize empty chat history for Gemini
        })
        .eq('id', caseId);

      if (updateCaseError) {
        console.error('Error updating case status for Gemini:', updateCaseError);
        throw new Error('Failed to update case status for Gemini.');
      }

      return new Response(JSON.stringify({ message: 'Google Gemini analysis initiated successfully', caseId }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });

    } else {
      throw new Error(`Unsupported AI model: ${aiModel}`);
    }

  } catch (error: any) {
    console.error('Edge Function error:', error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});