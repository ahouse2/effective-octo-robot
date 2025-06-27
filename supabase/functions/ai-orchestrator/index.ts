import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import OpenAI from 'https://esm.sh/openai@4.52.7';
import { GoogleGenerativeAI } from 'https://esm.sh/@google/generative-ai@0.15.0';
import { v1 } from 'npm:@google-cloud/discoveryengine@2.2.0';

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

async function updateProgress(supabaseClient: SupabaseClient, caseId: string, progress: number, message: string) {
    await supabaseClient.from('cases').update({ analysis_progress: progress, analysis_status_message: message }).eq('id', caseId);
}

async function insertAgentActivity(supabaseClient: SupabaseClient, caseId: string, agentName: string, agentRole: string, activityType: string, content: string, status: 'processing' | 'completed' | 'error') {
  const { error } = await supabaseClient.from('agent_activities').insert({
    case_id: caseId,
    agent_name: agentName,
    agent_role: agentRole,
    activity_type: activityType,
    content: content,
    status: status,
  });
  if (error) console.error(`Failed to insert agent activity [${activityType}]`, error);
}

// --- OPENAI HANDLERS ---

async function getOrCreateAssistant(openai: OpenAI, supabaseClient: SupabaseClient, userId: string, caseId: string): Promise<{ assistantId: string, threadId: string }> {
    let { data: caseData, error: caseError } = await supabaseClient.from('cases').select('openai_assistant_id, openai_thread_id, name, case_goals, system_instruction').eq('id', caseId).single();
    if (caseError || !caseData) throw new Error(`Case not found: ${caseId}`);

    let assistantId = caseData.openai_assistant_id;
    if (!assistantId) {
        const { data: profileData } = await supabaseClient.from('profiles').select('openai_assistant_id').eq('id', userId).single();
        assistantId = profileData?.openai_assistant_id;
    }

    const instructions = `You are a specialized legal AI assistant for California family law. Your role is to analyze evidence, identify key facts, and help build a case theory. Base your analysis strictly on the provided files. Case Goals: ${caseData.case_goals}. System Instructions: ${caseData.system_instruction}`;

    if (assistantId) {
        await openai.beta.assistants.update(assistantId, { instructions, tools: [{ type: "file_search" }] });
    } else {
        const assistant = await openai.beta.assistants.create({
            name: `Family Law AI for Case: ${caseData.name}`,
            instructions,
            tools: [{ type: "file_search" }],
            model: "gpt-4o",
        });
        assistantId = assistant.id;
    }

    let threadId = caseData.openai_thread_id;
    if (!threadId) {
        const thread = await openai.beta.threads.create();
        threadId = thread.id;
    }

    await supabaseClient.from('cases').update({ openai_assistant_id: assistantId, openai_thread_id: threadId }).eq('id', caseId);
    return { assistantId, threadId };
}

async function handleOpenAICommand(supabaseClient: SupabaseClient, openai: OpenAI, caseId: string, userId: string, command: string, payload: any) {
    await updateProgress(supabaseClient, caseId, 10, 'Initializing OpenAI Assistant...');
    const { assistantId, threadId } = await getOrCreateAssistant(openai, supabaseClient, userId, caseId);
    let prompt = "";

    if (command === 're_run_analysis') {
        prompt = `Please perform a comprehensive analysis of all the evidence files associated with this case. Your primary objectives are to identify key themes, generate a high-level summary, create key insights, and update the case theory. Structure your response as a JSON object within a markdown block.`;
    } else if (command === 'user_prompt') {
        prompt = payload.promptContent;
    } else {
        throw new Error(`Unsupported OpenAI command: ${command}`);
    }

    await updateProgress(supabaseClient, caseId, 25, 'Sending prompt to OpenAI...');
    await openai.beta.threads.messages.create(threadId, { role: "user", content: prompt });
    const run = await openai.beta.threads.runs.create(threadId, { assistant_id: assistantId });

    await insertAgentActivity(supabaseClient, caseId, 'OpenAI Assistant', 'AI', 'Analysis Started', `Run created with ID: ${run.id}. Awaiting completion.`, 'processing');
    await supabaseClient.from('cases').update({ status: 'In Progress' }).eq('id', caseId);
    await updateProgress(supabaseClient, caseId, 50, 'OpenAI is processing the request...');
}

// --- GEMINI RAG HANDLER ---

async function handleGeminiRAGCommand(supabaseClient: SupabaseClient, genAI: GoogleGenerativeAI, caseId: string, command: string, payload: any) {
    let promptContent = payload.promptContent;
    if (command === 're_run_analysis') {
        promptContent = `Perform a comprehensive analysis of all documents. Summarize the key facts, events, and overall case narrative based on the entire evidence locker.`;
    }
    
    await updateProgress(supabaseClient, caseId, 10, 'Initializing Gemini and Vertex AI...');

    const gcpProjectId = Deno.env.get('GCP_PROJECT_ID');
    const gcpDataStoreId = Deno.env.get('GCP_VERTEX_AI_DATA_STORE_ID');
    const gcpServiceAccountKey = JSON.parse(Deno.env.get('GCP_SERVICE_ACCOUNT_KEY') ?? '{}');

    const discoveryEngineClient = new v1.SearchServiceClient({
      projectId: gcpProjectId,
      credentials: { client_email: gcpServiceAccountKey.client_email, private_key: gcpServiceAccountKey.private_key },
    });

    await updateProgress(supabaseClient, caseId, 25, 'Searching for relevant documents in Vertex AI...');
    const servingConfig = discoveryEngineClient.servingConfigPath(gcpProjectId, 'global', gcpDataStoreId, 'default_serving_config');
    const [searchResponse] = await discoveryEngineClient.search({ servingConfig, query: promptContent, pageSize: 5 });
    const contextSnippets = searchResponse.results?.map(r => r.document?.derivedStructData?.fields?.content?.stringValue).filter(Boolean).join('\n\n---\n\n');

    if (!contextSnippets) {
        await insertAgentActivity(supabaseClient, caseId, 'Gemini', 'System', 'No Context Found', 'Could not find relevant documents in Vertex AI for this query.', 'completed');
        await updateProgress(supabaseClient, caseId, 100, 'Analysis complete: No relevant documents found.');
        return; // End execution for this path
    }

    await updateProgress(supabaseClient, caseId, 60, 'Synthesizing response with Gemini...');
    const { data: caseDetails } = await supabaseClient.from('cases').select('case_goals, system_instruction').eq('id', caseId).single();
    const synthesisPrompt = `Based on the following context from case documents, answer the user's question. User's Question: "${promptContent}". Case Goals: ${caseDetails?.case_goals || 'Not specified.'}. System Instructions: ${caseDetails?.system_instruction || 'None.'}. Context from Documents: --- ${contextSnippets} --- Your Answer:`;

    const model = genAI.getGenerativeModel({ model: "gemini-pro" });
    const result = await model.generateContent(synthesisPrompt);
    const responseText = result.response.text();

    await insertAgentActivity(supabaseClient, caseId, 'Google Gemini', 'AI', 'RAG Response', responseText, 'completed');
    await supabaseClient.from('cases').update({ status: 'Analysis Complete' }).eq('id', caseId);
    await updateProgress(supabaseClient, caseId, 100, 'Analysis complete!');
}

// --- MAIN SERVE FUNCTION ---
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const supabaseClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false } });
    const { caseId, command, payload } = await req.json();
    const userId = await getUserIdFromRequest(req, supabaseClient);
    if (!caseId || !userId || !command) throw new Error('caseId, userId, and command are required');

    if (command === 'diagnose_case_settings') {
        const { data, error } = await supabaseClient.from('cases').select('*').eq('id', caseId).single();
        if (error || !data) {
            await insertAgentActivity(supabaseClient, caseId, 'Diagnostic Agent', 'System', 'Diagnostic Failed', `Could not fetch case settings: ${error?.message || 'Case not found.'}`, 'error');
            throw new Error('Failed to run diagnostics.');
        }
        const settingsReport = `
          --- Case Settings Report ---
          Case ID: ${data.id}
          Case Name: ${data.name}
          AI Model: ${data.ai_model}
          OpenAI Assistant ID: ${data.openai_assistant_id || 'Not set'}
          OpenAI Thread ID: ${data.openai_thread_id || 'Not set'}
          --------------------------
        `;
        await insertAgentActivity(supabaseClient, caseId, 'Diagnostic Agent', 'System', 'Diagnostic Report', settingsReport, 'completed');
        return new Response(JSON.stringify({ message: 'Diagnostics complete. Check the agent activity log.' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
    }

    const { data: caseData, error: caseError } = await supabaseClient.from('cases').select('ai_model').eq('id', caseId).single();
    if (caseError || !caseData) throw new Error('Case not found or error fetching case details.');
    
    const { ai_model } = caseData;

    await insertAgentActivity(supabaseClient, caseId, 'Orchestrator', 'System', 'Command Received', `Received command '${command}'. Fetched case settings. Routing to AI model: [${ai_model}].`, 'processing');
    
    await supabaseClient.from('cases').update({ status: 'In Progress' }).eq('id', caseId);

    if (ai_model === 'openai') {
        const openai = new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY') });
        await handleOpenAICommand(supabaseClient, openai, caseId, userId, command, payload);
    } else if (ai_model === 'gemini') {
        const genAI = new GoogleGenerativeAI(Deno.env.get('GOOGLE_GEMINI_API_KEY') ?? '');
        await handleGeminiRAGCommand(supabaseClient, genAI, caseId, command, payload);
    } else {
      await insertAgentActivity(supabaseClient, caseId, 'Orchestrator', 'System', 'Routing Error', `Unsupported or null AI model configured: [${ai_model}]. Halting execution.`, 'error');
      throw new Error(`Unsupported AI model: ${ai_model}`);
    }

    // This is now the single point of return for all successful command executions.
    return new Response(JSON.stringify({ message: 'Command processed successfully.' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
  } catch (error: any) {
    console.error('Edge Function error:', error.message, error.stack);
    const supabaseClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    const { caseId } = await req.json().catch(() => ({ caseId: null }));
    if (caseId) {
        await supabaseClient.from('cases').update({ status: 'Error', analysis_status_message: error.message }).eq('id', caseId);
    }
    return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 });
  }
});