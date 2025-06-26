import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import OpenAI from 'https://esm.sh/openai@4.52.7';
import { GoogleGenerativeAI } from 'https://esm.sh/@google/generative-ai@0.15.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// --- UTILITY FUNCTIONS ---
async function getUserIdFromRequest(req: Request, supabaseClient: SupabaseClient): Promise<string | null> {
  try {
    const authHeader = req.headers.get('Authorization');
    if (authHeader) {
      const { data: { user }, error } = await supabaseClient.auth.getUser(authHeader.replace('Bearer ', ''));
      if (error) console.warn("getUserIdFromRequest: Failed to get user from JWT:", error.message);
      if (user) return user.id;
    }
    const userIdFromHeader = req.headers.get('x-supabase-user-id');
    if (userIdFromHeader) return userIdFromHeader;
    return null;
  } catch (e) {
    console.error("getUserIdFromRequest: Error getting user ID:", e);
    return null;
  }
}

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

async function updateCaseData(supabaseClient: SupabaseClient, caseId: string, assistantResponse: string) {
  const structuredData = extractJsonFromMarkdown(assistantResponse);
  if (!structuredData) return;

  if (structuredData.theory_update) {
    await supabaseClient.from('case_theories').update({ ...structuredData.theory_update, last_updated: new Date().toISOString() }).eq('case_id', caseId);
  }
  if (structuredData.insights && Array.isArray(structuredData.insights)) {
    const insightsToInsert = structuredData.insights.map((insight: any) => ({ ...insight, case_id: caseId, timestamp: new Date().toISOString() }));
    await supabaseClient.from('case_insights').insert(insightsToInsert);
  }
}

async function insertAgentActivity(supabaseClient: SupabaseClient, caseId: string, agentName: string, agentRole: string, activityType: string, content: string, status: 'processing' | 'completed' | 'error') {
  await supabaseClient.from('agent_activities').insert({ case_id: caseId, agent_name: agentName, agent_role: agentRole, activity_type: activityType, content: content, status: status, timestamp: new Date().toISOString() });
}

// --- FILE PRE-PROCESSING ---
async function preprocessFiles(supabaseClient: SupabaseClient, openai: OpenAI, caseId: string) {
    await insertAgentActivity(supabaseClient, caseId, 'AI Orchestrator', 'File Processor', 'Starting File Pre-processing', 'Checking for files that need categorization and summarization.', 'processing');
    
    const { data: filesToProcess, error } = await supabaseClient
        .from('case_files_metadata')
        .select('id, file_name, file_path')
        .eq('case_id', caseId)
        .or('description.is.null,file_category.is.null');

    if (error) {
        await insertAgentActivity(supabaseClient, caseId, 'AI Orchestrator', 'Error Handler', 'File Pre-processing Failed', `Could not fetch files to process: ${error.message}`, 'error');
        return;
    }

    if (!filesToProcess || filesToProcess.length === 0) {
        await insertAgentActivity(supabaseClient, caseId, 'AI Orchestrator', 'File Processor', 'No Files to Pre-process', 'All files are already categorized and summarized.', 'completed');
        return;
    }

    await insertAgentActivity(supabaseClient, caseId, 'AI Orchestrator', 'File Processor', 'Processing Files', `Found ${filesToProcess.length} files to process.`, 'processing');

    for (const file of filesToProcess) {
        try {
            const { data: fileBlob } = await supabaseClient.storage.from('evidence-files').download(file.file_path);
            if (!fileBlob) continue;

            let contentSnippet = "";
            try {
                contentSnippet = (await fileBlob.text()).substring(0, 4000);
            } catch (e) {
                console.warn(`Could not read file ${file.file_name} as text. Proceeding with filename only.`);
            }

            const prompt = `
                Analyze the following file information.
                Original Filename: "${file.file_name}"
                Content Snippet (if available): "${contentSnippet}"

                Provide a logical category, a new descriptive filename, a concise summary, and relevant tags.
                The filename should follow YYYY-MM-DD_Document-Type_Brief-Description.ext format.
                The new filename must not contain any slashes ('/' or '\\').

                Respond ONLY with a JSON object in the format:
                {
                  "category": "Your Suggested Category",
                  "suggestedName": "Your-Suggested-Filename.ext",
                  "summary": "Your one or two sentence summary here.",
                  "tags": ["tag1", "tag2", "tag3"]
                }
            `;

            const completion = await openai.chat.completions.create({
                model: "gpt-4o",
                messages: [{ role: "user", content: prompt }],
                response_format: { type: "json_object" },
            });

            const result = JSON.parse(completion.choices[0].message.content || '{}');
            const { category, suggestedName, summary, tags } = result;

            await supabaseClient.from('case_files_metadata').update({
                file_category: category,
                suggested_name: suggestedName?.replace(/[\\/]/g, '_'),
                description: summary,
                tags: Array.isArray(tags) ? tags.map(String) : [],
            }).eq('id', file.id);

        } catch (e) {
            await insertAgentActivity(supabaseClient, caseId, 'AI Orchestrator', 'Error Handler', 'File Processing Error', `Failed to process file ${file.file_name}: ${e.message}`, 'error');
        }
    }
    await insertAgentActivity(supabaseClient, caseId, 'AI Orchestrator', 'File Processor', 'File Pre-processing Complete', 'All files have been categorized and summarized.', 'completed');
}


// --- OPENAI HANDLERS ---
async function handleOpenAIToolCall(supabaseClient: SupabaseClient, caseId: string, toolCall: any): Promise<{ tool_call_id: string; output: string }> {
  if (toolCall.function.name === 'web_search') {
    await insertAgentActivity(supabaseClient, caseId, 'OpenAI Assistant', 'Tool Executor', 'Web Search Initiated', `Performing web search for: ${toolCall.function.arguments}`, 'processing');
    try {
      const args = JSON.parse(toolCall.function.arguments);
      const { data: searchResult, error: searchError } = await supabaseClient.functions.invoke('web-search', { body: JSON.stringify({ query: args.query }) });
      if (searchError) throw new Error(`Web search failed: ${searchError.message}`);
      const output = JSON.stringify(searchResult?.results || []);
      await insertAgentActivity(supabaseClient, caseId, 'Web Search Agent', 'Tool Executor', 'Web Search Completed', output, 'completed');
      return { tool_call_id: toolCall.id, output: output };
    } catch (toolError: any) {
      await insertAgentActivity(supabaseClient, caseId, 'Web Search Agent', 'Error Handler', 'Web Search Failed', `Web search failed: ${toolError.message}`, 'error');
      return { tool_call_id: toolCall.id, output: `Error: ${toolError.message}` };
    }
  }
  return { tool_call_id: toolCall.id, output: `Unknown tool: ${toolCall.function.name}` };
}

async function handleCompletedRun(supabaseClient: SupabaseClient, openai: OpenAI, caseId: string, threadId: string, activityType: string) {
    const messages = await openai.beta.threads.messages.list(threadId, { order: 'desc', limit: 1 });
    if (messages.data[0]?.role === 'assistant') {
        const assistantResponse = messages.data[0].content.map(block => block.type === 'text' ? block.text.value : '').join('\n');
        await updateCaseData(supabaseClient, caseId, assistantResponse);
        await insertAgentActivity(supabaseClient, caseId, 'OpenAI Assistant', 'AI', activityType, assistantResponse, 'completed');
    }
}

async function pollOpenAIRun(openai: OpenAI, supabaseClient: SupabaseClient, caseId: string, threadId: string, runId: string): Promise<string> {
  const startTime = Date.now();
  const TIMEOUT_MS = 55000;

  while (Date.now() - startTime < TIMEOUT_MS) {
    const retrievedRun = await openai.beta.threads.runs.retrieve(threadId, runId);
    console.log(`OpenAI Run Status for case ${caseId}: ${retrievedRun.status}`);

    if (['completed', 'failed', 'cancelled', 'expired'].includes(retrievedRun.status)) {
      return retrievedRun.status;
    }

    if (retrievedRun.status === 'requires_action' && retrievedRun.required_action?.type === 'submit_tool_outputs') {
      const toolOutputs = await Promise.all(retrievedRun.required_action.submit_tool_outputs.tool_calls.map(tc => handleOpenAIToolCall(supabaseClient, caseId, tc)));
      if (toolOutputs.length > 0) {
        await openai.beta.threads.runs.submitToolOutputs(threadId, runId, { tool_outputs: toolOutputs });
      }
    }
    
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  return 'timed_out';
}

async function handleNewFilesForOpenAI(supabaseClient: SupabaseClient, openai: OpenAI, caseId: string) {
    await insertAgentActivity(supabaseClient, caseId, 'AI Orchestrator', 'File Processor', 'Uploading files to OpenAI', 'Checking for files to upload to OpenAI Assistant.', 'processing');
    const { data: filesToUpload } = await supabaseClient.from('case_files_metadata').select('id, file_name, file_path, openai_file_id').eq('case_id', caseId);
    const newFiles = filesToUpload?.filter(f => !f.openai_file_id) || [];

    if (newFiles.length === 0) {
        await insertAgentActivity(supabaseClient, caseId, 'AI Orchestrator', 'File Processor', 'No new files for OpenAI', 'No new files found to upload to OpenAI.', 'completed');
        return [];
    }

    const uploadPromises = newFiles.map(async (meta) => {
        const { data: fileBlob } = await supabaseClient.storage.from('evidence-files').download(meta.file_path);
        if (fileBlob) {
            const fileNameOnly = meta.file_name.split('/').pop() || meta.file_name;
            const openaiFile = await openai.files.create({ file: new File([fileBlob], fileNameOnly), purpose: 'assistants' });
            await supabaseClient.from('case_files_metadata').update({ openai_file_id: openaiFile.id }).eq('id', meta.id);
            return { file_id: openaiFile.id, tools: [{ type: "file_search" }] as { type: string }[] };
        }
        return null;
    });

    const results = await Promise.all(uploadPromises);
    const attachments = results.filter(r => r !== null) as { file_id: string; tools: { type: string }[] }[];
    await insertAgentActivity(supabaseClient, caseId, 'AI Orchestrator', 'File Processor', 'OpenAI Upload Complete', `${attachments.length} new files uploaded to OpenAI.`, 'completed');
    return attachments;
}

async function handleOpenAICommand(supabaseClient: SupabaseClient, openai: OpenAI, caseId: string, command: string, payload: any, openaiThreadId: string, openaiAssistantId: string) {
    let run: any = null;
    let activityType = 'Response';

    if (command === 'user_prompt') {
        const { promptContent, mentionedFilename } = payload;
        let attachments: { file_id: string; tools: { type: string }[] }[] = [];
        let finalPromptContent = promptContent;

        if (mentionedFilename) {
            const { data: fileMeta } = await supabaseClient.from('case_files_metadata').select('openai_file_id').eq('case_id', caseId).or(`suggested_name.eq.${mentionedFilename},file_name.eq.${mentionedFilename}`).limit(1).single();
            if (fileMeta?.openai_file_id) {
                attachments.push({ file_id: fileMeta.openai_file_id, tools: [{ type: "file_search" }] });
                finalPromptContent = `The user is asking a question about the attached file, "${mentionedFilename}". The question is: ${promptContent}`;
            }
        }
        await openai.beta.threads.messages.create(openaiThreadId, { role: "user", content: finalPromptContent, attachments });
        run = await openai.beta.threads.runs.create(openaiThreadId, { assistant_id: openaiAssistantId });

    } else if (command === 're_run_analysis') {
        activityType = 'Full Re-analysis';
        await insertAgentActivity(supabaseClient, caseId, 'User', 'Command', 'Re-run Analysis', 'User requested a full re-analysis of the case.', 'processing');
        
        // Centralized pre-processing and OpenAI upload step
        await preprocessFiles(supabaseClient, openai, caseId);
        const attachments = await handleNewFilesForOpenAI(supabaseClient, openai, caseId);

        await openai.beta.threads.messages.create(openaiThreadId, {
            role: "user",
            content: "Please perform a full re-analysis of all evidence files provided for this case from scratch. Re-evaluate everything based on the current case goals and instructions, and provide a comprehensive new case theory and set of insights.",
            attachments: attachments,
        });
        run = await openai.beta.threads.runs.create(openaiThreadId, { assistant_id: openaiAssistantId });

    } else if (command === 'update_assistant_instructions') {
        await insertAgentActivity(supabaseClient, caseId, 'User', 'Command', 'Update Instructions', 'User updated case goals or system instructions.', 'processing');
        const { data: caseData } = await supabaseClient.from('cases').select('case_goals, system_instruction').eq('id', caseId).single();
        if (caseData) {
            const structuredOutputInstruction = `When providing updates or summaries, include structured JSON data within a markdown code block (\`\`\`json{...}\`\`\`). This JSON should contain updates to the case theory ("theory_update") and/or new insights ("insights").`;
            const instructions = `You are a specialized AI assistant for California family law cases. Your primary goal is to analyze evidence, identify key facts, legal arguments, and potential outcomes.\nUser's Case Goals: ${caseData.case_goals || 'Not specified.'}\nUser's System Instruction: ${caseData.system_instruction || 'None provided.'}\n${structuredOutputInstruction}`;
            await openai.beta.assistants.update(openaiAssistantId, { instructions });
            await insertAgentActivity(supabaseClient, caseId, 'AI Orchestrator', 'Setup', 'Assistant Updated', 'Assistant instructions have been updated.', 'completed');
        } else {
            await insertAgentActivity(supabaseClient, caseId, 'AI Orchestrator', 'Error Handler', 'Update Failed', 'Could not retrieve case data to update assistant.', 'error');
        }
    }

    if (run) {
        const finalStatus = await pollOpenAIRun(openai, supabaseClient, caseId, openaiThreadId, run.id);
        if (finalStatus === 'completed') {
            await handleCompletedRun(supabaseClient, openai, caseId, openaiThreadId, activityType);
        } else if (finalStatus === 'timed_out') {
            await insertAgentActivity(supabaseClient, caseId, 'AI Orchestrator', 'System', 'Processing Timeout', 'The AI is taking longer than expected. The analysis is still running in the background. You can ask for an update later.', 'completed');
        } else {
            await insertAgentActivity(supabaseClient, caseId, 'AI Orchestrator', 'Error Handler', 'Run Failed', `The AI analysis run failed with status: ${finalStatus}.`, 'error');
            throw new Error(`OpenAI Assistant run failed with status: ${finalStatus}`);
        }
    }
}

async function setupNewOpenAICase(supabaseClient: SupabaseClient, openai: OpenAI, caseId: string, payload: any) {
    const { caseGoals, systemInstruction, openaiAssistantId: clientProvidedAssistantId } = payload;
    await insertAgentActivity(supabaseClient, caseId, 'AI Orchestrator', 'Setup', 'Starting OpenAI Setup', 'Preparing assistant and thread for the new case.', 'processing');
    
    const structuredOutputInstruction = `When providing updates or summaries, include structured JSON data within a markdown code block (\`\`\`json{...}\`\`\`). This JSON should contain updates to the case theory ("theory_update") and/or new insights ("insights").`;
    const instructions = `You are a specialized AI assistant for California family law cases. Your primary goal is to analyze evidence, identify key facts, legal arguments, and potential outcomes.\nUser's Case Goals: ${caseGoals || 'Not specified.'}\nUser's System Instruction: ${systemInstruction || 'None provided.'}\n${structuredOutputInstruction}`;
    
    let assistant;
    if (clientProvidedAssistantId) {
        assistant = await openai.beta.assistants.update(clientProvidedAssistantId, { instructions, model: "gpt-4o", tools: [{ type: "file_search" }, { type: "function", function: { name: "web_search", description: "Perform a web search.", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } } }] });
    } else {
        assistant = await openai.beta.assistants.create({ name: `Family Law AI - Case ${caseId}`, instructions, model: "gpt-4o", tools: [{ type: "file_search" }, { type: "function", function: { name: "web_search", description: "Perform a web search.", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } } }] });
    }

    const thread = await openai.beta.threads.create();

    await supabaseClient.from('cases').update({ openai_thread_id: thread.id, openai_assistant_id: assistant.id, status: 'In Progress' }).eq('id', caseId);
    await insertAgentActivity(supabaseClient, caseId, 'AI Orchestrator', 'Setup', 'OpenAI Setup Complete', `Assistant ID: ${assistant.id}, Thread ID: ${thread.id}. Ready for analysis.`, 'completed');
}

// --- MAIN SERVE FUNCTION ---
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabaseClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false } });
    const { caseId, command, payload } = await req.json();
    const userId = await getUserIdFromRequest(req, supabaseClient);

    if (!caseId || !userId || !command) {
      return new Response(JSON.stringify({ error: 'caseId, userId, and command are required' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 });
    }

    const { data: caseData, error: caseError } = await supabaseClient.from('cases').select('ai_model, openai_thread_id, openai_assistant_id').eq('id', caseId).single();
    if (caseError || !caseData) throw new Error('Case not found or error fetching case details.');

    const { ai_model, openai_thread_id, openai_assistant_id } = caseData;

    if (command === 'setup_new_case_ai') {
        const { aiModel } = payload;
        if (aiModel === 'openai') {
            const openai = new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY') });
            await setupNewOpenAICase(supabaseClient, openai, caseId, payload);
        } else {
            await insertAgentActivity(supabaseClient, caseId, 'Google Gemini', 'Setup', 'Setup Complete', 'Gemini case ready. Awaiting user prompt.', 'completed');
            await supabaseClient.from('cases').update({ status: 'In Progress' }).eq('id', caseId);
        }
        return new Response(JSON.stringify({ message: 'AI setup process initiated.' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
    } else if (command === 'switch_ai_model') {
        const { newAiModel } = payload;
        await insertAgentActivity(supabaseClient, caseId, 'User', 'Command', 'Switch AI Model', `User switched AI model to ${newAiModel}.`, 'processing');
        if (newAiModel === 'openai') {
            const { data: caseDataForSwitch } = await supabaseClient.from('cases').select('case_goals, system_instruction, openai_assistant_id').eq('id', caseId).single();
            const openai = new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY') });
            await setupNewOpenAICase(supabaseClient, openai, caseId, { ...caseDataForSwitch, openaiAssistantId: caseDataForSwitch?.openai_assistant_id });
        } else {
            await supabaseClient.from('cases').update({ openai_thread_id: null, openai_assistant_id: null, status: 'In Progress' }).eq('id', caseId);
            await insertAgentActivity(supabaseClient, caseId, 'Google Gemini', 'Setup', 'Setup Complete', 'Gemini case ready. Awaiting user prompt.', 'completed');
        }
        return new Response(JSON.stringify({ message: 'AI model switched and setup initiated.' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
    }

    if (ai_model === 'openai') {
      if (!openai_thread_id || !openai_assistant_id) throw new Error('OpenAI thread or assistant ID missing for this case.');
      const openai = new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY') });
      await handleOpenAICommand(supabaseClient, openai, caseId, command, payload, openai_thread_id, openai_assistant_id);
    } else if (ai_model === 'gemini') {
      // Gemini handling logic would go here
      await insertAgentActivity(supabaseClient, caseId, 'Google Gemini', 'System', 'Command Received', `Received command '${command}' but Gemini logic is not yet implemented.`, 'completed');
    } else {
      throw new Error(`Unsupported AI model: ${ai_model}`);
    }

    return new Response(JSON.stringify({ message: 'Command processed successfully.', caseId }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
  } catch (error: any) {
    console.error('Edge Function error:', error.message, error.stack);
    return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 });
  }
});