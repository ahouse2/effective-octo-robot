import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.50.1';
import OpenAI from 'https://esm.sh/openai@4.52.7';
import { GoogleGenerativeAI } from 'https://esm.sh/@google/generative-ai@0.15.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
};

const MAX_CONTEXT_LENGTH = 50000; // A safe character limit for the context window

// --- UTILITY FUNCTIONS ---
function extractJson(text: string): any | null {
  const jsonRegex = /```json\s*([\s\S]*?)\s*```|({[\s\S]*}|\[[\s\S]*\])/;
  const match = text.match(jsonRegex);
  if (match) {
    const jsonString = match[1] || match[2];
    if (jsonString) {
        try {
            return JSON.parse(jsonString);
        } catch (e) {
            console.error("Failed to parse extracted JSON string:", jsonString, e);
            return null;
        }
    }
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

// --- SEARCH HANDLER ---
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

  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite-preview-06-17" });
  const result = await model.generateContent(prompt);
  const responseText = (result as any).response.text(); // Type assertion
  const jsonResult = extractJson(responseText);

  if (!jsonResult) {
    await insertAgentActivity(supabaseClient, caseId, 'Search Agent', 'System', 'Search Failed', 'AI did not return valid JSON for search results.', 'error');
    return { results: [] };
  }
  
  await insertAgentActivity(supabaseClient, caseId, 'Search Agent', 'System', 'Search Complete', `Found ${jsonResult.results?.length || 0} relevant files.`, 'completed');
  return jsonResult;
}

// --- OPENAI & GEMINI HANDLERS ---
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
    
    let attachments: { file_id: string, tools: { type: 'file_search' }[] }[] = [];

    if (command === 're_run_analysis') {
        await updateProgress(supabaseClient, caseId, 15, 'Fetching and uploading evidence to OpenAI...');
        const { data: files, error: filesError } = await supabaseClient.from('case_files_metadata').select('file_path, openai_file_id').eq('case_id', caseId);
        if (filesError) throw new Error(`Failed to fetch files for analysis: ${filesError.message}`);

        const uploadedFileIds = [];
        for (const file of files) {
            if (file.openai_file_id) {
                uploadedFileIds.push(file.openai_file_id);
                continue;
            }
            const { data: blob, error: downloadError } = await supabaseClient.storage.from('evidence-files').download(file.file_path);
            if (downloadError) {
                console.error(`Skipping file ${file.file_path} due to download error: ${downloadError.message}`);
                continue;
            }
            const uploadedFile = await openai.files.create({ file: blob, purpose: 'assistants' });
            await supabaseClient.from('case_files_metadata').update({ openai_file_id: uploadedFile.id }).eq('file_path', file.file_path);
            uploadedFileIds.push(uploadedFile.id);
        }
        attachments = uploadedFileIds.map(fileId => ({ file_id: fileId, tools: [{ type: 'file_search' }] }));
    }

    let prompt = "";
    if (command === 're_run_analysis') {
        prompt = `Please perform a comprehensive analysis of all the evidence files associated with this case. Your primary objectives are to identify key themes, generate a high-level summary, create key insights, and update the case theory. Structure your response as a JSON object within a markdown block.`;
    } else if (command === 'user_prompt') {
        prompt = payload.promptContent;
    } else {
        throw new Error(`Unsupported OpenAI command: ${command}`);
    }

    await updateProgress(supabaseClient, caseId, 25, 'Sending prompt to OpenAI...');
    await openai.beta.threads.messages.create(threadId, { 
        role: "user", 
        content: prompt,
        attachments: attachments.length > 0 ? attachments : undefined,
    });

    const run = await openai.beta.threads.runs.create(threadId, { assistant_id: assistantId });

    await insertAgentActivity(supabaseClient, caseId, 'OpenAI Assistant', 'AI', 'Analysis Started', `Run created with ID: ${run.id}. Awaiting completion.`, 'processing');
    await supabaseClient.from('cases').update({ status: 'In Progress' }).eq('id', caseId);
    await updateProgress(supabaseClient, caseId, 50, 'OpenAI is processing the request...');

    await supabaseClient.functions.invoke('check-openai-run-status', {
        body: { caseId, threadId, runId: run.id },
    });
}

async function handleGeminiRAGCommand(supabaseClient: SupabaseClient, genAI: GoogleGenerativeAI, caseId: string, command: string, payload: any) {
    let promptContent = payload.promptContent;
    let files;
    let dbSearchError;

    if (command === 're_run_analysis') {
        promptContent = `Perform a comprehensive analysis of all documents. Summarize the key facts, events, and overall case narrative based on the entire evidence locker.`;
        await updateProgress(supabaseClient, caseId, 10, 'Gathering all evidence summaries...');
        await insertAgentActivity(supabaseClient, caseId, 'Gemini RAG', 'System', 'Process Started', 'Gathering all available evidence for a full analysis.', 'processing');
        
        const { data, error } = await supabaseClient
            .from('case_files_metadata')
            .select('suggested_name, description')
            .eq('case_id', caseId)
            .not('description', 'is', null);
        files = data;
        dbSearchError = error;

    } else {
        await updateProgress(supabaseClient, caseId, 10, 'Searching for relevant documents in Supabase...');
        await insertAgentActivity(supabaseClient, caseId, 'Gemini RAG', 'System', 'Process Started', 'Performing text search on file summaries within Supabase.', 'processing');
        
        const stopWords = new Set(['a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has', 'he', 'in', 'is', 'it', 'its', 'of', 'on', 'that', 'the', 'to', 'was', 'were', 'will', 'with', 'this', 'those', 'all', 'any', 'etc']);
        const searchTerms = Array.from(new Set(
            promptContent.toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g,"").split(/\s+/).filter(term => term.length > 3 && !stopWords.has(term))
        ));

        if (searchTerms.length === 0) {
            await insertAgentActivity(supabaseClient, caseId, 'Gemini', 'System', 'No Search Terms', 'Could not extract meaningful search terms from the prompt.', 'completed');
            return;
        }

        const { data, error } = await supabaseClient
            .from('case_files_metadata')
            .select('suggested_name, description')
            .eq('case_id', caseId)
            .or(searchTerms.map(term => `description.ilike.%${term}%`).join(','));
        files = data;
        dbSearchError = error;
    }

    if (dbSearchError) {
        throw new Error(`Failed to search file metadata: ${dbSearchError.message}`);
    }

    if (!files || files.length === 0) {
        await insertAgentActivity(supabaseClient, caseId, 'Gemini', 'System', 'No Context Found', 'Could not find relevant documents for this query. Ensure files have been summarized.', 'completed');
        await updateProgress(supabaseClient, caseId, 100, 'Analysis complete: No relevant documents found.');
        return;
    }

    await updateProgress(supabaseClient, caseId, 30, `Found ${files.length} files to analyze.`);
    let contextSnippets = files.map(file => `From file "${file.suggested_name}":\n${file.description}`).join('\n\n---\n\n');
    
    if (contextSnippets.length > MAX_CONTEXT_LENGTH) {
        await insertAgentActivity(supabaseClient, caseId, 'Gemini RAG', 'System', 'Context Too Large', `Context of ${contextSnippets.length} chars exceeds limit. Pre-summarizing...`, 'processing');
        const preSummarizationPrompt = `The following text is a collection of summaries from various legal documents. It is too long to process. Please summarize this entire collection into a more concise overview, retaining all key facts, names, dates, and legal concepts. Combined Summaries:\n\n${contextSnippets}`;
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite-preview-06-17" });
        const result = await model.generateContent(preSummarizationPrompt);
        contextSnippets = (result as any).response.text(); // Type assertion
        await insertAgentActivity(supabaseClient, caseId, 'Gemini RAG', 'System', 'Pre-summarization Complete', `Context reduced to ${contextSnippets.length} chars.`, 'completed');
    }

    await insertAgentActivity(supabaseClient, caseId, 'Gemini RAG', 'System', 'Search Complete', `Using context of ${contextSnippets.length} chars.`, 'completed');

    await updateProgress(supabaseClient, caseId, 50, 'Synthesizing analysis with Gemini...');
    const { data: caseDetails } = await supabaseClient.from('cases').select('case_goals, system_instruction, user_specified_arguments').eq('id', caseId).single();
    
    const analysisPrompt = `
      You are a master legal analyst AI specializing in California family law. Your primary value is to identify non-obvious patterns, correlations, and discrepancies across the entire evidence set that a human analyst might miss. Connect disparate pieces of information to form a cohesive narrative.
      
      Based on the provided context from multiple evidence files, perform a comprehensive analysis. Your response MUST be a single JSON object containing two keys: "case_theory" and "case_insights".

      1.  **case_theory**: An object with three keys: "fact_patterns", "legal_arguments", and "potential_outcomes". Each should be an array of strings.
      2.  **case_insights**: An array of objects, where each object has "title", "description", and "insight_type" ('key_fact', 'risk_assessment', 'outcome_trend', or 'general').

      The user has provided the following directives:
      - **Primary Case Goals:** ${caseDetails?.case_goals || 'Not specified.'}
      - **Specific Legal Arguments to Investigate:** ${caseDetails?.user_specified_arguments || 'None specified.'}
      - **General System Instructions:** ${caseDetails?.system_instruction || 'None.'}

      Pay special attention to evidence that supports or refutes the user-specified legal arguments.

      Example JSON structure:
      \`\`\`json
      {
        "case_theory": {
          "fact_patterns": ["Consistent communication breakdown between parties.", "Evidence of hidden financial assets in file 'Bank Statement 2023.pdf'."],
          "legal_arguments": ["Breach of fiduciary duty regarding community property.", "Argument for primary custody based on documented instability."],
          "potential_outcomes": ["Unequal division of assets due to financial misconduct.", "Supervised visitation for one party."]
        },
        "case_insights": [
          {
            "title": "Undisclosed Financial Account",
            "description": "The file 'Bank Statement 2023.pdf' shows a previously undisclosed bank account with a significant balance, which is a major key fact.",
            "insight_type": "key_fact"
          }
        ]
      }
      \`\`\`

      Here is the context from the evidence files:
      ---
      ${contextSnippets}
      ---
    `;

    const synthesisPrompt = command === 're_run_analysis' ? analysisPrompt : `Based on the following context from case documents, answer the user's question. User's Question: "${promptContent}". Case Goals: ${caseDetails?.case_goals || 'Not specified.'}. System Instructions: ${caseDetails?.system_instruction || 'None.'}. Context from Documents: --- ${contextSnippets} --- Your Answer:`;
    
    await insertAgentActivity(supabaseClient, caseId, 'Gemini RAG', 'System', 'Prompt Synthesis', `Sending prompt of length ${synthesisPrompt.length} to Gemini.`, 'processing');

    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite-preview-06-17" });
    const result = await model.generateContent(synthesisPrompt);
    
    const response = (result as any).response; // Type assertion
    if (!response) throw new Error("The AI model did not return a valid response.");
    if ((response as any).promptFeedback?.blockReason) { // Type assertion
        const blockReason = (response as any).promptFeedback.blockReason; // Type assertion
        const safetyRatings = (response as any).promptFeedback.safetyRatings?.map((r: any) => `${r.category}: ${r.probability}`).join(', '); // Type assertion
        throw new Error(`The AI's response was blocked for safety reasons. Reason: ${blockReason}. Details: [${safetyRatings}].`);
    }
    
    const responseText = (response as any).text(); // Type assertion
    await updateProgress(supabaseClient, caseId, 80, 'Parsing AI response and updating database...');

    if (command === 're_run_analysis') {
        const jsonResult = extractJson(responseText);
        if (!jsonResult) {
          throw new Error(`AI did not return a valid JSON object. Raw response: ${responseText}`);
        }

        if (jsonResult.case_theory) {
            await supabaseClient.from('case_theories').upsert({
                case_id: caseId,
                fact_patterns: jsonResult.case_theory.fact_patterns,
                legal_arguments: jsonResult.case_theory.legal_arguments,
                potential_outcomes: jsonResult.case_theory.potential_outcomes,
                status: 'refined',
                last_updated: new Date().toISOString()
            }, { onConflict: 'case_id' });
        }

        if (jsonResult.case_insights && jsonResult.case_insights.length > 0) {
            await supabaseClient.from('case_insights').delete().eq('case_id', caseId);
            const insightsToInsert = jsonResult.case_insights.map((insight: any) => ({
                case_id: caseId,
                title: insight.title,
                description: insight.description,
                insight_type: insight.insight_type
            }));
            await supabaseClient.from('case_insights').insert(insightsToInsert);
        }
        await insertAgentActivity(supabaseClient, caseId, 'Google Gemini', 'AI', 'Full Analysis Complete', `Successfully parsed and saved new case theory and ${jsonResult.case_insights?.length || 0} insights.`, 'completed');
    } else {
        await insertAgentActivity(supabaseClient, caseId, 'Google Gemini', 'AI', 'RAG Response', responseText, 'completed');
    }

    await supabaseClient.from('cases').update({ status: 'Analysis Complete' }).eq('id', caseId);
    await updateProgress(supabaseClient, caseId, 100, 'Analysis complete!');
}

// --- MAIN SERVE FUNCTION ---
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  let body;
  try {
    body = await req.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Invalid JSON in request body' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const supabaseClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false } });
  const { caseId, command, payload } = body;

  try {
    const userId = await getUserIdFromRequest(req, supabaseClient);
    if (!caseId || !userId || !command) throw new Error('caseId, userId, and command are required');

    if (command === 'search_evidence') {
        const genAI = new GoogleGenerativeAI(Deno.env.get('GOOGLE_GEMINI_API_KEY') ?? '');
        const searchResults = await handleSearchCommand(supabaseClient, genAI, caseId, payload.query);
        return new Response(JSON.stringify(searchResults), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
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

    if (command === 'diagnose_gemini_connection') {
        try {
            const geminiApiKey = Deno.env.get('GOOGLE_GEMINI_API_KEY');
            if (!geminiApiKey) throw new Error("GOOGLE_GEMINI_API_KEY secret is not set.");
    
            const genAI = new GoogleGenerativeAI(geminiApiKey);
            const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite-preview-06-17" }); 
            
            await model.generateContent("test");
    
            await insertAgentActivity(supabaseClient, caseId, 'Diagnostic Agent', 'System', 'Gemini Connection Test', 'Successfully connected to Google Gemini API with the gemini-2.5-flash-lite-preview-06-17 model.', 'completed');
            return new Response(JSON.stringify({ message: 'Gemini API connection successful for gemini-2.5-flash-lite-preview-06-17!' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
        } catch (e: any) { // Type assertion
            console.error("Gemini Connection Diagnosis Error:", e);
            await insertAgentActivity(supabaseClient, caseId, 'Diagnostic Agent', 'System', 'Gemini Connection Test Failed', `Failed to connect to Gemini API using gemini-2.5-flash-lite-preview-06-17: ${e.message}`, 'error');
            throw new Error(`Gemini Connection Test Failed for gemini-2.5-flash-lite-preview-06-17: ${e.message}. Please verify your GOOGLE_GEMINI_API_KEY secret and ensure it has permissions for this model.`);
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
      throw new Error(`Unsupported AI model: ${ai_model}`);
    }

    return new Response(JSON.stringify({ message: 'Command processed successfully.' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
  } catch (error: any) {
    console.error('Edge Function error:', error.message, error.stack);
    await insertAgentActivity(supabaseClient, caseId, 'Orchestrator', 'System', 'Critical Error', error.message, 'error');
    await supabaseClient.from('cases').update({ status: 'Error', analysis_status_message: 'A critical error occurred.' }).eq('id', caseId);
    return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 });
  }
});