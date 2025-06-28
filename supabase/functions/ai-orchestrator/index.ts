import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
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
    console.log("GEMINI_HANDLER: Entered handleGeminiRAGCommand");
    let promptContent = payload.promptContent;
    if (command === 're_run_analysis') {
        promptContent = `Perform a comprehensive analysis of all documents. Summarize the key facts, events, and overall case narrative based on the entire evidence locker.`;
    }
    
    await updateProgress(supabaseClient, caseId, 10, 'Initializing Gemini and Vertex AI...');
    console.log("GEMINI_HANDLER: Progress updated to 10%");

    // --- Environment Variable Validation ---
    console.log("GEMINI_HANDLER: Validating secrets...");
    const gcpProjectId = Deno.env.get('GCP_PROJECT_ID');
    const gcpDataStoreId = Deno.env.get('GCP_VERTEX_AI_DATA_STORE_ID');
    const gcpServiceAccountKeyRaw = Deno.env.get('GCP_SERVICE_ACCOUNT_KEY');
    const geminiApiKey = Deno.env.get('GOOGLE_GEMINI_API_KEY');

    if (!gcpProjectId || !gcpDataStoreId || !gcpServiceAccountKeyRaw || !geminiApiKey) {
        const missing = [
            !gcpProjectId && 'GCP_PROJECT_ID',
            !gcpDataStoreId && 'GCP_VERTEX_AI_DATA_STORE_ID',
            !gcpServiceAccountKeyRaw && 'GCP_SERVICE_ACCOUNT_KEY',
            !geminiApiKey && 'GOOGLE_GEMINI_API_KEY'
        ].filter(Boolean).join(', ');
        console.error(`GEMINI_HANDLER: Missing secrets: ${missing}`);
        throw new Error(`Gemini analysis failed: Missing required Supabase secrets: ${missing}. Please configure them in your project settings.`);
    }
    console.log("GEMINI_HANDLER: All secrets are present.");

    let gcpServiceAccountKey;
    try {
        console.log("GEMINI_HANDLER: Parsing GCP_SERVICE_ACCOUNT_KEY...");
        gcpServiceAccountKey = JSON.parse(gcpServiceAccountKeyRaw);
        if (!gcpServiceAccountKey.client_email || !gcpServiceAccountKey.private_key) {
            console.error("GEMINI_HANDLER: Service account key is missing required fields.");
            throw new Error("The 'GCP_SERVICE_ACCOUNT_KEY' secret is a valid JSON but is missing the required 'client_email' or 'private_key' fields.");
        }
        console.log("GEMINI_HANDLER: Service account key parsed successfully.");
    } catch (e) {
        console.error("GEMINI_HANDLER: Failed to parse service account key.", e);
        throw new Error("Gemini analysis failed: The 'GCP_SERVICE_ACCOUNT_KEY' secret is not valid JSON. Please ensure you have copied the entire contents of the JSON key file, including the opening and closing curly braces {}.");
    }
    
    console.log("GEMINI_HANDLER: Initializing Discovery Engine client...");
    const discoveryEngineClient = new v1.SearchServiceClient({
      projectId: gcpProjectId,
      credentials: { client_email: gcpServiceAccountKey.client_email, private_key: gcpServiceAccountKey.private_key },
    });
    console.log("GEMINI_HANDLER: Discovery Engine client initialized.");

    await updateProgress(supabaseClient, caseId, 25, 'Searching for relevant documents in Vertex AI...');
    console.log("GEMINI_HANDLER: Progress updated to 25%. Starting search.");
    let searchResponse;
    try {
        const servingConfig = discoveryEngineClient.servingConfigPath(gcpProjectId, 'global', gcpDataStoreId, 'default_serving_config');
        console.log(`GEMINI_HANDLER: Searching with config: ${servingConfig}`);
        [searchResponse] = await discoveryEngineClient.search({ servingConfig, query: promptContent, pageSize: 5 });
        console.log("GEMINI_HANDLER: Search completed successfully.");
    } catch (e) {
        console.error("GEMINI_HANDLER: Vertex AI Search Error:", e);
        throw new Error(`Failed to search documents in Vertex AI. Please check your GCP project permissions (the service account needs the 'Vertex AI User' role), that the Vertex AI Search API is enabled, and that your Data Store ID is correct. Original error: ${e.message}`);
    }
    
    const contextSnippets = searchResponse.results?.map(r => r.document?.derivedStructData?.fields?.content?.stringValue).filter(Boolean).join('\n\n---\n\n');
    console.log(`GEMINI_HANDLER: Found ${searchResponse.results?.length || 0} snippets.`);

    if (!contextSnippets) {
        console.log("GEMINI_HANDLER: No context snippets found. Ending process.");
        await insertAgentActivity(supabaseClient, caseId, 'Gemini', 'System', 'No Context Found', 'Could not find relevant documents in Vertex AI for this query.', 'completed');
        await updateProgress(supabaseClient, caseId, 100, 'Analysis complete: No relevant documents found.');
        return;
    }

    await updateProgress(supabaseClient, caseId, 60, 'Synthesizing response with Gemini...');
    console.log("GEMINI_HANDLER: Progress updated to 60%. Synthesizing response.");
    const { data: caseDetails } = await supabaseClient.from('cases').select('case_goals, system_instruction').eq('id', caseId).single();
    const synthesisPrompt = `Based on the following context from case documents, answer the user's question. User's Question: "${promptContent}". Case Goals: ${caseDetails?.case_goals || 'Not specified.'}. System Instructions: ${caseDetails?.system_instruction || 'None.'}. Context from Documents: --- ${contextSnippets} --- Your Answer:`;

    const model = genAI.getGenerativeModel({ model: "gemini-pro" });
    let result;
    try {
        console.log("GEMINI_HANDLER: Generating content with Gemini...");
        result = await model.generateContent(synthesisPrompt);
        console.log("GEMINI_HANDLER: Content generation successful.");
    } catch (e) {
        console.error("GEMINI_HANDLER: Gemini Generation Error:", e);
        throw new Error(`Failed to generate content with Gemini. Please check your Gemini API key and permissions. Original error: ${e.message}`);
    }
    
    const responseText = result.response.text();
    console.log("GEMINI_HANDLER: Response received from Gemini.");

    await insertAgentActivity(supabaseClient, caseId, 'Google Gemini', 'AI', 'RAG Response', responseText, 'completed');
    await supabaseClient.from('cases').update({ status: 'Analysis Complete' }).eq('id', caseId);
    await updateProgress(supabaseClient, caseId, 100, 'Analysis complete!');
    console.log("GEMINI_HANDLER: Process completed successfully.");
}

// --- MAIN SERVE FUNCTION ---
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const supabaseClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false } });
    const { caseId, command, payload } = await req.json();
    const userId = await getUserIdFromRequest(req, supabaseClient);
    if (!caseId || !userId || !command) throw new Error('caseId, userId, and command are required');

    if (command === 'search_evidence') {
        const gcpProjectId = Deno.env.get('GCP_PROJECT_ID');
        const gcpDataStoreId = Deno.env.get('GCP_VERTEX_AI_DATA_STORE_ID');
        const gcpServiceAccountKey = JSON.parse(Deno.env.get('GCP_SERVICE_ACCOUNT_KEY') ?? '{}');
        const discoveryEngineClient = new v1.SearchServiceClient({
            projectId: gcpProjectId,
            credentials: { client_email: gcpServiceAccountKey.client_email, private_key: gcpServiceAccountKey.private_key },
        });
        const servingConfig = discoveryEngineClient.servingConfigPath(gcpProjectId, 'global', gcpDataStoreId, 'default_serving_config');
        const [searchResponse] = await discoveryEngineClient.search({
            servingConfig,
            query: payload.query,
            pageSize: 10,
            contentSearchSpec: { snippetSpec: { returnSnippet: true }, summarySpec: { includeCitations: true } }
        });
        const results = searchResponse.results?.map(r => ({
            id: r.document?.id,
            snippets: r.document?.derivedStructData?.fields?.snippets?.listValue?.values?.map(v => v.structValue?.fields?.snippet?.stringValue) || []
        })) || [];
        return new Response(JSON.stringify({ results }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
    }

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

    if (command === 'diagnose_gcp_connection') {
      try {
        const gcpServiceAccountKeyRaw = Deno.env.get('GCP_SERVICE_ACCOUNT_KEY');
        if (!gcpServiceAccountKeyRaw) throw new Error("GCP_SERVICE_ACCOUNT_KEY secret is not set.");
        const gcpServiceAccountKey = JSON.parse(gcpServiceAccountKeyRaw);
        if (!gcpServiceAccountKey.client_email || !gcpServiceAccountKey.private_key) {
            throw new Error("GCP_SERVICE_ACCOUNT_KEY is not a valid JSON key file.");
        }
        const gcpProjectId = Deno.env.get('GCP_PROJECT_ID');
        if (!gcpProjectId) throw new Error("GCP_PROJECT_ID secret is not set.");

        const discoveryEngineClient = new v1.SearchServiceClient({
          projectId: gcpProjectId,
          credentials: { client_email: gcpServiceAccountKey.client_email, private_key: gcpServiceAccountKey.private_key },
        });
        await discoveryEngineClient.listDataStores({parent: `projects/${gcpProjectId}/locations/global/collections/default_collection`});
        
        return new Response(JSON.stringify({ message: 'GCP connection successful!' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
      } catch (e) {
        console.error("GCP Connection Diagnosis Error:", e);
        throw new Error(`GCP Connection Test Failed: ${e.message}. Please verify your GCP_PROJECT_ID and GCP_SERVICE_ACCOUNT_KEY secrets. The service account may also need the 'Vertex AI User' role in your GCP project.`);
      }
    }

    const { data: caseData, error: caseError } = await supabaseClient.from('cases').select('ai_model').eq('id', caseId).single();
    if (caseError || !caseData) throw new Error('Case not found or error fetching case details.');
    
    let { ai_model } = caseData;

    if (ai_model === 'gemini') {
        await supabaseClient.from('cases').update({ openai_assistant_id: null, openai_thread_id: null }).eq('id', caseId);
        await insertAgentActivity(supabaseClient, caseId, 'Orchestrator', 'System', 'Housekeeping', 'Cleared legacy OpenAI settings for Gemini case.', 'completed');
    }

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