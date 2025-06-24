import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import OpenAI from 'https://esm.sh/openai@4.52.7';
import { GoogleGenerativeAI } from 'https://esm.sh/@google/generative-ai@0.15.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { caseId, fileNames, caseGoals, systemInstruction, aiModel } = await req.json();
    const userId = req.headers.get('x-supabase-user-id');

    if (!caseId || !userId || !aiModel) {
      return new Response(JSON.stringify({ error: 'Case ID, User ID, and AI Model are required' }), {
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

    let openaiThreadId: string | undefined;
    let openaiAssistantId: string | undefined;

    if (aiModel === 'openai') {
      const openai = new OpenAI({
        apiKey: Deno.env.get('OPENAI_API_KEY'),
      });

      // Upload files to OpenAI and collect file_ids
      const openaiFileIds: string[] = [];
      for (const fileName of fileNames) {
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

      // 4. Create or retrieve an OpenAI Assistant
      let assistantId = Deno.env.get('OPENAI_ASSISTANT_ID');
      let assistant;

      if (assistantId) {
        try {
          assistant = await openai.beta.assistants.retrieve(assistantId);
          console.log('Using existing OpenAI Assistant:', assistant.id);
        } catch (retrieveError: any) {
          console.warn(`Failed to retrieve existing Assistant with ID ${assistantId}: ${retrieveError.message}. Creating a new one.`);
          assistantId = undefined; // Force creation of a new assistant
        }
      }

      if (!assistantId) {
        try {
          assistant = await openai.beta.assistants.create({
            name: "Family Law AI Assistant",
            instructions: `You are a specialized AI assistant for California family law cases. Your primary goal is to analyze evidence, identify key facts, legal arguments, and potential outcomes. You should be precise, objective, and focus on the legal implications of the provided documents. Always cite the source document when making claims.
            
            User's Case Goals: ${caseGoals || 'Not specified.'}
            User's System Instruction: ${systemInstruction || 'None provided.'}
            
            You have access to a 'file_search' tool for documents uploaded directly to me.
            Additionally, you have a custom tool called 'search_case_files' to search for files by name within the user's Supabase storage. Use this tool when the user explicitly asks to search for files by name or mentions keywords related to file names.
            
            When responding, provide updates on your analysis progress, key findings, and any questions you have. Structure your output clearly for legal professionals.`,
            tools: [
              { type: "file_search" },
              {
                type: "function",
                function: {
                  name: "search_case_files",
                  description: "Search for case files by name in the user's Supabase storage.",
                  parameters: {
                    type: "object",
                    properties: {
                      query: {
                        type: "string",
                        description: "The search query for file names (e.g., 'financial statements', 'emails from 2023').",
                      },
                    },
                    required: ["query"],
                  },
                },
              },
            ],
            model: "gpt-4o", // Or another suitable model like "gpt-4-turbo"
          });
          assistantId = assistant.id;
          console.log('Created new OpenAI Assistant:', assistant.id);
          await supabaseClient.from('agent_activities').insert({
            case_id: caseId,
            agent_name: 'OpenAI Setup',
            agent_role: 'Configuration',
            activity_type: 'Assistant Created',
            content: `New OpenAI Assistant created with ID: ${assistant.id}. Please save this ID as OPENAI_ASSISTANT_ID in Supabase secrets for future use.`,
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

      // 6. Add initial message to the thread with file references
      const initialMessageContent = `Please begin the analysis for the case. The primary case goals are: "${caseGoals || 'Not specified.'}". Additional system instructions: "${systemInstruction || 'None provided.'}". The uploaded files are now available for analysis.`;
      
      await openai.beta.threads.messages.create(
        thread.id,
        {
          role: "user",
          content: initialMessageContent,
          attachments: openaiFileIds.map(fileId => ({ file_id: fileId, tools: [{ type: "file_search" }] })),
        }
      );
      console.log('Added initial message and files to thread.');

      // 7. Create a run for the Assistant to process the initial message and files
      const run = await openai.beta.threads.runs.create(
        thread.id,
        {
          assistant_id: assistantId,
        }
      );
      console.log('Initiated OpenAI Run:', run.id);

      // 8. Update the cases table with OpenAI thread and assistant IDs
      const { error: updateCaseError } = await supabaseClient
        .from('cases')
        .update({
          openai_thread_id: thread.id,
          openai_assistant_id: assistantId,
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
        content: `OpenAI Assistant (ID: ${assistantId}) started analysis on Thread (ID: ${thread.id}). Run ID: ${run.id}.`,
        status: 'processing',
      });

      return new Response(JSON.stringify({ message: 'AI analysis initiated successfully', caseId, threadId: thread.id, runId: run.id }), {
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