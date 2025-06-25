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

async function pollOpenAIRun(openai: OpenAI, supabaseClient: SupabaseClient, caseId: string, threadId: string, runId: string): Promise<string> {
  while (true) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    const retrievedRun = await openai.beta.threads.runs.retrieve(threadId, runId);
    console.log(`OpenAI Run Status for case ${caseId}: ${retrievedRun.status}`);

    if (['queued', 'in_progress', 'cancelling'].includes(retrievedRun.status)) {
      continue;
    }
    if (retrievedRun.status === 'requires_action' && retrievedRun.required_action?.type === 'submit_tool_outputs') {
      const toolOutputs = await Promise.all(retrievedRun.required_action.submit_tool_outputs.tool_calls.map(tc => handleOpenAIToolCall(supabaseClient, caseId, tc)));
      if (toolOutputs.length > 0) {
        await openai.beta.threads.runs.submitToolOutputs(threadId, runId, { tool_outputs: toolOutputs });
      }
      continue;
    }
    return retrievedRun.status;
  }
}

async function handleOpenAICommand(supabaseClient: SupabaseClient, openai: OpenAI, caseId: string, command: string, payload: any, openaiThreadId: string, openaiAssistantId: string) {
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
    const run = await openai.beta.threads.runs.create(openaiThreadId, { assistant_id: openaiAssistantId });
    const finalStatus = await pollOpenAIRun(openai, supabaseClient, caseId, openaiThreadId, run.id);

    if (finalStatus === 'completed') {
      const messages = await openai.beta.threads.messages.list(openaiThreadId, { order: 'desc', limit: 1 });
      if (messages.data[0]?.role === 'assistant') {
        const assistantResponse = messages.data[0].content.map(block => block.type === 'text' ? block.text.value : '').join('\n');
        await updateCaseData(supabaseClient, caseId, assistantResponse);
        await insertAgentActivity(supabaseClient, caseId, 'OpenAI Assistant', 'AI', 'Response', assistantResponse, 'completed');
      }
    } else {
      throw new Error(`OpenAI Assistant run failed with status: ${finalStatus}`);
    }
  }
}

async function setupNewOpenAICase(supabaseClient: SupabaseClient, openai: OpenAI, caseId: string, userId: string, payload: any) {
    const { caseGoals, systemInstruction, openaiAssistantId: clientProvidedAssistantId } = payload;
    
    await insertAgentActivity(supabaseClient, caseId, 'AI Orchestrator', 'Setup', 'Starting OpenAI Setup', 'Preparing assistant and thread for the new case.', 'processing');

    const { data: filesToUpload } = await supabaseClient.from('case_files_metadata').select('id, file_name, file_path').eq('case_id', caseId).is('openai_file_id', null);
    const attachments: { file_id: string; tools: { type: string }[] }[] = [];
    if (filesToUpload && filesToUpload.length > 0) {
        const uploadPromises = filesToUpload.map(async (meta) => {
            const { data: fileBlob } = await supabaseClient.storage.from('evidence-files').download(meta.file_path);
            if (fileBlob) {
                const openaiFile = await openai.files.create({ file: new File([fileBlob], meta.file_name), purpose: 'assistants' });
                await supabaseClient.from('case_files_metadata').update({ openai_file_id: openaiFile.id }).eq('id', meta.id);
                return { file_id: openaiFile.id, tools: [{ type: "file_search" }] };
            }
            return null;
        });
        const results = await Promise.all(uploadPromises);
        attachments.push(...results.filter(r => r !== null) as any[]);
        await insertAgentActivity(supabaseClient, caseId, 'AI Orchestrator', 'File Processor', 'Initial Files Uploaded', `${attachments.length} files uploaded to OpenAI.`, 'completed');
    }

    const structuredOutputInstruction = `When providing updates or summaries, include structured JSON data within a markdown code block (\`\`\`json{...}\`\`\`). This JSON should contain updates to the case theory ("theory_update") and/or new insights ("insights").`;
    const instructions = `You are a specialized AI assistant for California family law cases. Your primary goal is to analyze evidence, identify key facts, legal arguments, and potential outcomes.
    User's Case Goals: ${caseGoals || 'Not specified.'}
    User's System Instruction: ${systemInstruction || 'None provided.'}
    ${structuredOutputInstruction}`;
    
    let assistant;
    if (clientProvidedAssistantId) {
        assistant = await openai.beta.assistants.update(clientProvidedAssistantId, { instructions, model: "gpt-4o", tools: [{ type: "file_search" }, { type: "function", function: { name: "web_search", description: "Perform a web search.", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } } }] });
    } else {
        assistant = await openai.beta.assistants.create({ name: `Family Law AI - Case ${caseId}`, instructions, model: "gpt-4o", tools: [{ type: "file_search" }, { type: "function", function: { name: "web_search", description: "Perform a web search.", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } } }] });
    }

    const thread = await openai.beta.threads.create();
    await openai.beta.threads.messages.create(thread.id, { role: "user", content: "Please begin the analysis of the provided files based on the case goals and instructions.", attachments });
    const run = await openai.beta.threads.runs.create(thread.id, { assistant_id: assistant.id });

    await supabaseClient.from('cases').update({ openai_thread_id: thread.id, openai_assistant_id: assistant.id, status: 'In Progress' }).eq('id', caseId);
    await insertAgentActivity(supabaseClient, caseId, 'AI Orchestrator', 'Setup', 'OpenAI Setup Complete', `Assistant ID: ${assistant.id}, Thread ID: ${thread.id}. Analysis is running.`, 'completed');

    const finalStatus = await pollOpenAIRun(openai, supabaseClient, caseId, thread.id, run.id);
    if (finalStatus === 'completed') {
        const messages = await openai.beta.threads.messages.list(thread.id, { order: 'desc', limit: 1 });
        if (messages.data[0]?.role === 'assistant') {
            const assistantResponse = messages.data[0].content.map(block => block.type === 'text' ? block.text.value : '').join('\n');
            await updateCaseData(supabaseClient, caseId, assistantResponse);
            await insertAgentActivity(supabaseClient, caseId, 'OpenAI Assistant', 'AI', 'Initial Analysis', assistantResponse, 'completed');
        }
    } else {
        throw new Error(`Initial run failed with status: ${finalStatus}`);
    }
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

    if (command === 'setup_new_case_ai') {
        const { aiModel } = payload;
        if (aiModel === 'openai') {
            const openai = new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY') });
            await setupNewOpenAICase(supabaseClient, openai, caseId, userId, payload);
        } else {
            await insertAgentActivity(supabaseClient, caseId, 'Google Gemini', 'Setup', 'Setup Complete', 'Gemini case ready. Awaiting user prompt.', 'completed');
            await supabaseClient.from('cases').update({ status: 'In Progress' }).eq('id', caseId);
        }
        return new Response(JSON.stringify({ message: 'AI setup completed in background.' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
    }

    const { data: caseData, error: caseError } = await supabaseClient.from('cases').select('ai_model, openai_thread_id, openai_assistant_id, gemini_chat_history').eq('id', caseId).single();
    if (caseError || !caseData) throw new Error('Case not found or error fetching case details.');

    const { ai_model, openai_thread_id, openai_assistant_id, gemini_chat_history } = caseData;

    if (ai_model === 'openai') {
      if (!openai_thread_id || !openai_assistant_id) throw new Error('OpenAI thread or assistant ID missing for this case.');
      const openai = new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY') });
      await handleOpenAICommand(supabaseClient, openai, caseId, command, payload, openai_thread_id, openai_assistant_id);
    } else if (ai_model === 'gemini') {
      // Gemini handling logic would go here
    } else {
      throw new Error(`Unsupported AI model: ${ai_model}`);
    }

    return new Response(JSON.stringify({ message: 'Command processed successfully.', caseId }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
  } catch (error: any) {
    console.error('Edge Function error:', error.message, error.stack);
    return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 });
  }
});