import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import OpenAI from 'https://esm.sh/openai@4.52.7';
import { GoogleGenerativeAI } from 'https://esm.sh/@google/generative-ai@0.15.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// --- UTILITY FUNCTIONS ---
// ... (utility functions remain the same)
function extractJson(text: string): string | null {
  const jsonRegex = /```json\s*([\s\S]*?)\s*```|({[\s\S]*}|\[[\s\S]*\])/;
  const match = text.match(jsonRegex);
  if (match) {
    return match[1] || match[0];
  }
  return null;
}

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

// --- NEW SEARCH HANDLER ---
async function handleSearchCommand(supabaseClient: SupabaseClient, genAI: GoogleGenerativeAI, caseId: string, query: string) {
  await insertAgentActivity(supabaseClient, caseId, 'Search Agent', 'System', 'Search Started', `Searching for: "${query}"`, 'processing');

  const { data: files, error } = await supabaseClient
    .from('case_files_metadata')
    .select('id, suggested_name, description')
    .eq('case_id', caseId)
    .not('description', 'is', null);

  if (error) throw new Error(`Failed to fetch files for search: ${error.message}`);
  if (!files || files.length === 0) return { results: [] };

  const context = files.map(file => `File ID: ${file.id}\nFilename: ${file.suggested_name}\nSummary: ${file.description}`).join('\n\n---\n\n');

  const prompt = `
    You are a semantic search engine. Based on the user's query, analyze the following file summaries and identify the most relevant files.
    For each relevant file, provide its ID and one or more short, relevant snippets from its summary that directly relate to the query.
    The user's query is: "${query}"

    Your response MUST be a JSON object with a single key "results", which is an array of objects. Each object should have "id" (the file ID) and "snippets" (an array of strings).
    Highlight the most relevant words in the snippets using <b> tags.
    
    Example Response:
    {
      "results": [
        {
          "id": "uuid-of-the-file",
          "snippets": ["...alleges <b>unauthorized transfer</b> of funds...", "...shows a previously <b>undisclosed bank account</b>..."]
        }
      ]
    }

    Here is the context of all file summaries:
    ---
    ${context}
    ---
  `;

  const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro-latest" });
  const result = await model.generateContent(prompt);
  const responseText = result.response.text();
  const jsonResult = extractJson(responseText);

  if (!jsonResult) {
    await insertAgentActivity(supabaseClient, caseId, 'Search Agent', 'System', 'Search Failed', 'AI did not return valid JSON for search results.', 'error');
    return { results: [] };
  }
  
  await insertAgentActivity(supabaseClient, caseId, 'Search Agent', 'System', 'Search Complete', `Found ${jsonResult.results?.length || 0} relevant files.`, 'completed');
  return jsonResult;
}


// --- OPENAI & GEMINI HANDLERS (remain the same) ---
// ...

// --- MAIN SERVE FUNCTION ---
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  let body;
  try {
    body = await req.json();
  } catch (e) {
    // For GET or other requests without a body, don't crash.
    if (req.method !== 'POST') {
        body = {};
    } else {
        return new Response(JSON.stringify({ error: 'Invalid JSON in request body' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
  }

  try {
    const supabaseClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false } });
    const { caseId, command, payload } = body;
    const userId = await getUserIdFromRequest(req, supabaseClient);
    if (!caseId || !userId || !command) throw new Error('caseId, userId, and command are required');

    // --- NEW SEARCH ROUTE ---
    if (command === 'search_evidence') {
        const genAI = new GoogleGenerativeAI(Deno.env.get('GOOGLE_GEMINI_API_KEY') ?? '');
        const searchResults = await handleSearchCommand(supabaseClient, genAI, caseId, payload.query);
        return new Response(JSON.stringify(searchResults), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
    }

    // ... (rest of the command routing logic remains the same)
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

    if (command === 'diagnose_gemini_connection') {
        try {
            const geminiApiKey = Deno.env.get('GOOGLE_GEMINI_API_KEY');
            if (!geminiApiKey) throw new Error("GOOGLE_GEMINI_API_KEY secret is not set.");
    
            const genAI = new GoogleGenerativeAI(geminiApiKey);
            const model = genAI.getGenerativeModel({ model: "gemini-2.5-pro" }); 
            
            await model.generateContent("test");
    
            await insertAgentActivity(supabaseClient, caseId, 'Diagnostic Agent', 'System', 'Gemini Connection Test', 'Successfully connected to Google Gemini API with the gemini-2.5-pro model.', 'completed');
            return new Response(JSON.stringify({ message: 'Gemini API connection successful for gemini-2.5-pro!' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
        } catch (e) {
            console.error("Gemini Connection Diagnosis Error:", e);
            await insertAgentActivity(supabaseClient, caseId, 'Diagnostic Agent', 'System', 'Gemini Connection Test Failed', `Failed to connect to Gemini API using gemini-2.5-pro: ${e.message}`, 'error');
            throw new Error(`Gemini Connection Test Failed for gemini-2.5-pro: ${e.message}. Please verify your GOOGLE_GEMINI_API_KEY secret and ensure it has permissions for this model.`);
        }
    }

    const { data: caseData, error: caseError } = await supabaseClient.from('cases').select('ai_model').eq('id', caseId).single();
    if (caseError || !caseData) throw new Error('Case not found or error fetching case details.');
    
    let { ai_model } = caseData;

    if (ai_model === 'gemini') {
        const genAI = new GoogleGenerativeAI(Deno.env.get('GOOGLE_GEMINI_API_KEY') ?? '');
        await handleGeminiRAGCommand(supabaseClient, genAI, caseId, command, payload);
    } else if (ai_model === 'openai') {
        const openai = new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY') });
        await handleOpenAICommand(supabaseClient, openai, caseId, userId, command, payload);
    } else {
      await insertAgentActivity(supabaseClient, caseId, 'Orchestrator', 'System', 'Routing Error', `Unsupported or null AI model configured: [${ai_model}]. Halting execution.`, 'error');
      throw new Error(`Unsupported AI model: ${ai_model}`);
    }

    return new Response(JSON.stringify({ message: 'Command processed successfully.' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
  } catch (error: any) {
    console.error('Edge Function error:', error.message, error.stack);
    const supabaseClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    const caseIdFromRequest = body?.caseId;
    if (caseIdFromRequest) {
        await supabaseClient.from('cases').update({ status: 'Error', analysis_status_message: error.message }).eq('id', caseIdFromRequest);
    }
    return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 });
  }
});