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

// --- PROVIDER-SPECIFIC FILE PRE-PROCESSING ---

async function preprocessFiles(supabaseClient: SupabaseClient, caseId: string, ai_model: 'openai' | 'gemini') {
    await supabaseClient.from('cases').update({ status: 'Processing Evidence' }).eq('id', caseId);
    await insertAgentActivity(supabaseClient, caseId, 'AI Orchestrator', 'File Processor', 'Starting File Pre-processing', `Checking for files to process using ${ai_model}.`, 'processing');
    
    const { data: filesToProcess, error } = await supabaseClient
        .from('case_files_metadata')
        .select('id, file_name, file_path')
        .eq('case_id', caseId)
        .or('description.is.null,file_category.is.null');

    if (error) throw new Error(`Could not fetch files to process: ${error.message}`);
    if (!filesToProcess || filesToProcess.length === 0) {
        await insertAgentActivity(supabaseClient, caseId, 'AI Orchestrator', 'File Processor', 'No Files to Pre-process', 'All files are already categorized and summarized.', 'completed');
        return;
    }

    for (const file of filesToProcess) {
        try {
            const { data: fileBlob } = await supabaseClient.storage.from('evidence-files').download(file.file_path);
            if (!fileBlob) continue;
            const contentSnippet = (await fileBlob.text()).substring(0, 4000);
            const prompt = `Analyze file info. Filename: "${file.file_name}", Snippet: "${contentSnippet}". Respond ONLY with JSON: {"category": "...", "suggestedName": "YYYY-MM-DD_Type_Desc.ext", "summary": "...", "tags": ["t1"]}`;
            
            let result: any;
            if (ai_model === 'openai') {
                const openai = new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY') });
                const completion = await openai.chat.completions.create({ model: "gpt-4o", messages: [{ role: "user", content: prompt }], response_format: { type: "json_object" } });
                result = JSON.parse(completion.choices[0].message.content || '{}');
            } else {
                const genAI = new GoogleGenerativeAI(Deno.env.get('GOOGLE_GEMINI_API_KEY') ?? '');
                const model = genAI.getGenerativeModel({ model: "gemini-pro" });
                const geminiResult = await model.generateContent(prompt);
                const textResponse = geminiResult.response.text();
                result = extractJsonFromMarkdown(textResponse) || JSON.parse(textResponse);
            }
            await supabaseClient.from('case_files_metadata').update({ file_category: result.category, suggested_name: result.suggestedName?.replace(/[\\/]/g, '_'), description: result.summary, tags: result.tags }).eq('id', file.id);
        } catch (e) {
            await insertAgentActivity(supabaseClient, caseId, 'AI Orchestrator', 'Error Handler', 'File Processing Error', `Failed to process file ${file.file_name}: ${e.message}`, 'error');
        }
    }
    await insertAgentActivity(supabaseClient, caseId, 'AI Orchestrator', 'File Processor', 'File Pre-processing Complete', 'All files have been categorized and summarized.', 'completed');
}

// --- OPENAI HANDLERS ---
async function handleOpenAICommand(supabaseClient: SupabaseClient, openai: OpenAI, caseId: string, command: string, payload: any, openaiThreadId: string, openaiAssistantId: string) {
    if (command === 're_run_analysis') {
        await insertAgentActivity(supabaseClient, caseId, 'User', 'Command', 'Re-run Analysis', 'User requested a full re-analysis of the case.', 'processing');
        await preprocessFiles(supabaseClient, caseId, 'openai');
        await supabaseClient.from('cases').update({ status: 'Generating Insights' }).eq('id', caseId);
        const attachments = await handleNewFilesForOpenAI(supabaseClient, openai, caseId);
        await openai.beta.threads.messages.create(openaiThreadId, { role: "user", content: "Perform a full re-analysis of all evidence files.", attachments });
        const run = await openai.beta.threads.runs.create(openaiThreadId, { assistant_id: openaiAssistantId });
        const finalStatus = await pollOpenAIRun(openai, supabaseClient, caseId, openaiThreadId, run.id);
        if (finalStatus === 'completed') {
            await handleCompletedRun(supabaseClient, openai, caseId, openaiThreadId, 'Full Re-analysis');
            await supabaseClient.from('cases').update({ status: 'Analysis Complete' }).eq('id', caseId);
        } else {
            throw new Error(`OpenAI Assistant run failed with status: ${finalStatus}`);
        }
    }
}

async function handleNewFilesForOpenAI(supabaseClient: SupabaseClient, openai: OpenAI, caseId: string) {
    const { data: filesToUpload } = await supabaseClient.from('case_files_metadata').select('id, file_name, file_path, openai_file_id').eq('case_id', caseId);
    const newFiles = filesToUpload?.filter(f => !f.openai_file_id) || [];
    if (newFiles.length === 0) return [];
    const uploadPromises = newFiles.map(async (meta) => {
        const { data: fileBlob } = await supabaseClient.storage.from('evidence-files').download(meta.file_path);
        if (fileBlob) {
            const openaiFile = await openai.files.create({ file: new File([fileBlob], meta.file_name.split('/').pop() || meta.file_name), purpose: 'assistants' });
            await supabaseClient.from('case_files_metadata').update({ openai_file_id: openaiFile.id }).eq('id', meta.id);
            return { file_id: openaiFile.id, tools: [{ type: "file_search" }] as { type: string }[] };
        }
        return null;
    });
    const results = await Promise.all(uploadPromises);
    return results.filter(r => r !== null) as { file_id: string; tools: { type: string }[] }[];
}

async function pollOpenAIRun(openai: OpenAI, supabaseClient: SupabaseClient, caseId: string, threadId: string, runId: string): Promise<string> {
  const startTime = Date.now();
  const TIMEOUT_MS = 55000;
  while (Date.now() - startTime < TIMEOUT_MS) {
    const retrievedRun = await openai.beta.threads.runs.retrieve(threadId, runId);
    if (['completed', 'failed', 'cancelled', 'expired'].includes(retrievedRun.status)) return retrievedRun.status;
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  return 'timed_out';
}

async function handleCompletedRun(supabaseClient: SupabaseClient, openai: OpenAI, caseId: string, threadId: string, activityType: string) {
    const messages = await openai.beta.threads.messages.list(threadId, { order: 'desc', limit: 1 });
    if (messages.data[0]?.role === 'assistant') {
        const assistantResponse = messages.data[0].content.map(block => block.type === 'text' ? block.text.value : '').join('\n');
        await updateCaseData(supabaseClient, caseId, assistantResponse);
        await insertAgentActivity(supabaseClient, caseId, 'OpenAI Assistant', 'AI', activityType, assistantResponse, 'completed');
    }
}

async function setupNewOpenAICase(supabaseClient: SupabaseClient, openai: OpenAI, caseId: string, payload: any) {
    const { caseGoals, systemInstruction } = payload;
    const instructions = `You are a specialized AI assistant...`;
    const assistant = await openai.beta.assistants.create({ name: `Family Law AI - Case ${caseId}`, instructions, model: "gpt-4o", tools: [{ type: "file_search" }] });
    const thread = await openai.beta.threads.create();
    await supabaseClient.from('cases').update({ openai_thread_id: thread.id, openai_assistant_id: assistant.id, status: 'In Progress' }).eq('id', caseId);
}

// --- GEMINI HANDLER ---
async function handleGeminiCommand(supabaseClient: SupabaseClient, genAI: GoogleGenerativeAI, caseId: string, command: string) {
    if (command === 're_run_analysis') {
        await insertAgentActivity(supabaseClient, caseId, 'User', 'Command', 'Re-run Analysis', 'User requested a full re-analysis of the case using Gemini.', 'processing');
        await preprocessFiles(supabaseClient, caseId, 'gemini');
        await supabaseClient.from('cases').update({ status: 'Generating Insights' }).eq('id', caseId);

        const { data: caseDetails } = await supabaseClient.from('cases').select('case_goals, system_instruction').eq('id', caseId).single();
        const { data: files } = await supabaseClient.from('case_files_metadata').select('suggested_name, description').eq('case_id', caseId);
        
        const evidenceSummary = files?.map(f => `- ${f.suggested_name}: ${f.description}`).join('\n') || 'No evidence summaries available.';
        const comprehensivePrompt = `
            You are a specialized AI assistant for California family law cases. Perform a comprehensive analysis of the following evidence.
            Case Goals: ${caseDetails?.case_goals || 'Not specified.'}
            System Instructions: ${caseDetails?.system_instruction || 'None.'}
            Evidence Summary:\n${evidenceSummary}
            Based on all information, generate a complete case theory and key insights. Respond ONLY with a JSON object in a markdown code block.
        `;

        const model = genAI.getGenerativeModel({ model: "gemini-pro" });
        const result = await model.generateContent(comprehensivePrompt);
        const responseText = result.response.text();
        
        await updateCaseData(supabaseClient, caseId, responseText);
        await insertAgentActivity(supabaseClient, caseId, 'Google Gemini', 'AI', 'Full Re-analysis', responseText, 'completed');
        await supabaseClient.from('cases').update({ status: 'Analysis Complete' }).eq('id', caseId);
    }
}

// --- MAIN SERVE FUNCTION ---
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const supabaseClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false } });
    const { caseId, command, payload } = await req.json();
    const userId = await getUserIdFromRequest(req, supabaseClient);
    if (!caseId || !userId || !command) throw new Error('caseId, userId, and command are required');

    await supabaseClient.from('cases').update({ status: 'In Progress' }).eq('id', caseId);

    const { data: caseData, error: caseError } = await supabaseClient.from('cases').select('ai_model, openai_thread_id, openai_assistant_id').eq('id', caseId).single();
    if (caseError || !caseData) throw new Error('Case not found or error fetching case details.');
    const { ai_model, openai_thread_id, openai_assistant_id } = caseData;

    if (ai_model === 'openai') {
        const openai = new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY') });
        if (command === 'setup_new_case_ai' || command === 'switch_ai_model') {
            await setupNewOpenAICase(supabaseClient, openai, caseId, payload);
        } else {
            if (!openai_thread_id || !openai_assistant_id) throw new Error('OpenAI thread or assistant ID missing for this case.');
            await handleOpenAICommand(supabaseClient, openai, caseId, command, payload, openai_thread_id, openai_assistant_id);
        }
    } else if (ai_model === 'gemini') {
        const genAI = new GoogleGenerativeAI(Deno.env.get('GOOGLE_GEMINI_API_KEY') ?? '');
        if (command === 'setup_new_case_ai' || command === 'switch_ai_model') {
            await supabaseClient.from('cases').update({ status: 'In Progress', openai_thread_id: null, openai_assistant_id: null }).eq('id', caseId);
        } else {
            await handleGeminiCommand(supabaseClient, genAI, caseId, command);
        }
    } else {
      throw new Error(`Unsupported AI model: ${ai_model}`);
    }
    return new Response(JSON.stringify({ message: 'Command processed successfully.' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
  } catch (error: any) {
    console.error('Edge Function error:', error.message, error.stack);
    const supabaseClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    const { caseId } = await req.json();
    if (caseId) {
        await supabaseClient.from('cases').update({ status: 'Error' }).eq('id', caseId);
        await insertAgentActivity(supabaseClient, caseId, 'AI Orchestrator', 'Error Handler', 'Critical Failure', error.message, 'error');
    }
    return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 });
  }
});