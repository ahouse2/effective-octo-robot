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

// --- commonUtils.ts content (inlined) ---
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

// --- openaiHandler.ts content (inlined) ---
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
    await new Promise(resolve => setTimeout(resolve, 1500));
    const retrievedRun = await openai.beta.threads.runs.retrieve(threadId, runId);
    console.log(`OpenAI Run Status: ${retrievedRun.status}`);

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

async function runOpenAIReAnalysis(openai: OpenAI, supabaseClient: SupabaseClient, caseId: string, threadId: string, assistantId: string, structuredOutputInstruction: string): Promise<string> {
  await insertAgentActivity(supabaseClient, caseId, 'AI Orchestrator', 'Analysis', 'Re-analysis Started', 'Starting a comprehensive re-analysis of all evidence.', 'processing');
  
  const { data: caseFiles, error: filesError } = await supabaseClient.from('case_files_metadata').select('openai_file_id').eq('case_id', caseId).not('openai_file_id', 'is', null);
  if (filesError) throw new Error('Failed to fetch case files for re-analysis.');
  
  const attachments = caseFiles?.map(f => ({ file_id: f.openai_file_id, tools: [{ type: "file_search" }] })) || [];
  
  const { data: caseData, error: caseFetchError } = await supabaseClient.from('cases').select('case_goals, system_instruction').eq('id', caseId).single();
  if (caseFetchError || !caseData) throw new Error('Case not found for re-analysis prompt.');

  const reanalysisPrompt = `Please perform a comprehensive re-analysis of all available evidence for this case, paying special attention to any newly added files.
  Current Case Goals: ${caseData.case_goals || 'Not specified.'}
  Current System Instructions: ${caseData.system_instruction || 'None provided.'}
  Review all files and provide updated fact patterns, legal arguments, and potential outcomes.
  ${structuredOutputInstruction}`;

  await openai.beta.threads.messages.create(threadId, { role: "user", content: reanalysisPrompt, attachments });
  const run = await openai.beta.threads.runs.create(threadId, { assistant_id: assistantId });
  const finalStatus = await pollOpenAIRun(openai, supabaseClient, caseId, threadId, run.id);

  if (finalStatus === 'completed') {
    const messages = await openai.beta.threads.messages.list(threadId, { order: 'desc', limit: 1 });
    const latestMessage = messages.data[0];
    if (latestMessage?.role === 'assistant') {
      const assistantResponse = latestMessage.content.map(block => block.type === 'text' ? block.text.value : '').join('\n');
      await updateCaseData(supabaseClient, caseId, assistantResponse);
      await insertAgentActivity(supabaseClient, caseId, 'OpenAI Assistant', 'AI', 'Re-analysis Completed', assistantResponse, 'completed');
      return 'OpenAI Assistant completed full re-analysis.';
    }
    await insertAgentActivity(supabaseClient, caseId, 'OpenAI Assistant', 'AI', 'Re-analysis Completed (No Response)', 'No visible response.', 'completed');
    return 'OpenAI Assistant completed full re-analysis but no response.';
  }
  await insertAgentActivity(supabaseClient, caseId, 'OpenAI Assistant', 'Error Handler', 'Re-analysis Failed', `Run failed with status: ${finalStatus}`, 'error');
  throw new Error(`OpenAI Assistant re-analysis run failed with status: ${finalStatus}`);
}

async function handleOpenAICommand(supabaseClient: SupabaseClient, openai: OpenAI, caseId: string, userId: string, command: string, payload: any, openaiThreadId: string, openaiAssistantId: string): Promise<string> {
  const structuredOutputInstruction = `When providing updates or summaries, include structured JSON data within a markdown code block (\`\`\`json{...}\`\`\`). This JSON should contain updates to the case theory ("theory_update") and/or new insights ("insights").`;

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
        return 'OpenAI Assistant responded.';
      }
    }
    throw new Error(`OpenAI Assistant run failed with status: ${finalStatus}`);
  } else if (command === 'initiate_analysis_on_new_files') {
    await insertAgentActivity(supabaseClient, caseId, 'AI Orchestrator', 'File Processor', 'Preparing New Files', 'Uploading new files to OpenAI.', 'processing');
    const { data: filesToUpload } = await supabaseClient.from('case_files_metadata').select('id, file_name, file_path').eq('case_id', caseId).is('openai_file_id', null);

    if (filesToUpload && filesToUpload.length > 0) {
      const uploadPromises = filesToUpload.map(async (meta) => {
        const { data: fileBlob } = await supabaseClient.storage.from('evidence-files').download(meta.file_path);
        if (fileBlob) {
          const openaiFile = await openai.files.create({ file: new File([fileBlob], meta.file_name), purpose: 'assistants' });
          await supabaseClient.from('case_files_metadata').update({ openai_file_id: openaiFile.id }).eq('id', meta.id);
        }
      });
      await Promise.all(uploadPromises);
      await insertAgentActivity(supabaseClient, caseId, 'AI Orchestrator', 'File Processor', 'File Upload Complete', `${filesToUpload.length} new files uploaded to OpenAI.`, 'completed');
    }
    return runOpenAIReAnalysis(openai, supabaseClient, caseId, openaiThreadId, openaiAssistantId, structuredOutputInstruction);
  } else if (command === 're_run_analysis') {
    await supabaseClient.from('cases').update({ status: 'In Progress', last_updated: new Date().toISOString() }).eq('id', caseId);
    return runOpenAIReAnalysis(openai, supabaseClient, caseId, openaiThreadId, openaiAssistantId, structuredOutputInstruction);
  } else if (command === 'update_assistant_instructions') {
    const { data: caseData } = await supabaseClient.from('cases').select('case_goals, system_instruction').eq('id', caseId).single();
    const newInstructions = `You are a specialized AI assistant for California family law cases. Your primary goal is to analyze evidence, identify key facts, legal arguments, and potential outcomes.
    User's Case Goals: ${caseData?.case_goals || 'Not specified.'}
    User's System Instruction: ${caseData?.system_instruction || 'None provided.'}
    ${structuredOutputInstruction}`;
    await openai.beta.assistants.update(openaiAssistantId, { instructions: newInstructions });
    await insertAgentActivity(supabaseClient, caseId, 'OpenAI Assistant', 'Configuration', 'Instructions Updated', 'Instructions updated successfully.', 'completed');
    return 'OpenAI Assistant instructions updated.';
  }
  throw new Error(`Unsupported command for OpenAI: ${command}`);
}

// --- geminiHandler.ts content (inlined) ---
// Gemini handler remains the same as it doesn't have the same file upload bottleneck.
async function handleGeminiCommand(supabaseClient: SupabaseClient, caseId: string, command: string, payload: any, geminiChatHistory: any[]): Promise<string> {
  // ... (existing Gemini logic, no changes needed for this fix)
  let responseMessage = '';
  const genAI = new GoogleGenerativeAI(Deno.env.get('GOOGLE_GEMINI_API_KEY') ?? '');
  const model = genAI.getGenerativeModel({ model: "gemini-pro" });

  const chat = model.startChat({
    history: geminiChatHistory || [],
    generationConfig: {
      maxOutputTokens: 2048,
    },
  });

  if (command === 'user_prompt') {
    const { promptContent, mentionedFilename } = payload;
    let finalPrompt = promptContent;

    if (mentionedFilename) {
      console.log(`Gemini: User mentioned file: ${mentionedFilename}`);
      const { data: fileMeta, error: metaError } = await supabaseClient
        .from('case_files_metadata')
        .select('file_path')
        .eq('case_id', caseId)
        .or(`suggested_name.eq.${mentionedFilename},file_name.eq.${mentionedFilename}`)
        .limit(1)
        .single();
      
      if (metaError || !fileMeta) {
        console.warn(`Could not find file path for mentioned file: ${mentionedFilename}. Error: ${metaError?.message}`);
        finalPrompt = `I tried to reference the file "${mentionedFilename}" but couldn't find it. Please answer this question generally: ${promptContent}`;
      } else {
        const { data: fileBlob, error: downloadError } = await supabaseClient.storage
          .from('evidence-files')
          .download(fileMeta.file_path);
        
        if (downloadError || !fileBlob) {
          console.error(`Failed to download file content for ${mentionedFilename}:`, downloadError);
          finalPrompt = `I tried to reference the file "${mentionedFilename}" but couldn't download its content. Please answer this question generally: ${promptContent}`;
        } else {
          const fileText = await fileBlob.text();
          finalPrompt = `The user is asking a question specifically about the file named "${mentionedFilename}". Here is the full content of that file:\n\n---FILE CONTENT START---\n${fileText}\n---FILE CONTENT END---\n\nNow, please answer the user's question based on the file's content. The question is: "${promptContent}"`;
        }
      }
    }

    try {
      const result = await chat.sendMessage(finalPrompt);
      const response = await result.response;
      const text = response.text();

      const updatedChatHistory = [...(geminiChatHistory || []),
        { role: 'user', parts: [{ text: finalPrompt }] },
        { role: 'model', parts: [{ text: text }] }
      ];
      await supabaseClient.from('cases').update({ gemini_chat_history: updatedChatHistory }).eq('id', caseId);

      await updateCaseData(supabaseClient, caseId, text);
      await insertAgentActivity(supabaseClient, caseId, 'Google Gemini', 'AI', 'Response', text, 'completed');
      responseMessage = 'Google Gemini responded.';
    } catch (geminiError: any) {
      console.error('Error interacting with Gemini:', geminiError);
      await insertAgentActivity(supabaseClient, caseId, 'Google Gemini', 'Error Handler', 'Gemini Interaction Failed', `Failed to get response from Gemini: ${geminiError.message}`, 'error');
      throw new Error(`Failed to get response from Gemini: ${geminiError.message}`);
    }

  } else if (command === 'initiate_analysis_on_new_files' || command === 're_run_analysis') {
    await insertAgentActivity(supabaseClient, caseId, 'Google Gemini', 'Analysis', 'Re-analysis Started', 'Gemini analysis initiated. RAG setup is required for document analysis.', 'completed');
    responseMessage = 'Gemini analysis initiated.';
  } else {
    throw new Error(`Unsupported command for Gemini: ${command}`);
  }
  return responseMessage;
}

// Main serve function
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabaseClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false } });
    const { caseId, command, payload } = await req.json();
    const userId = await getUserIdFromRequest(req, supabaseClient);

    if (!caseId || !userId || !command) {
      return new Response(JSON.stringify({ error: 'caseId, userId, and command are required' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 });
    }

    if (command === 'switch_ai_model') {
      const { newAiModel } = payload;
      await insertAgentActivity(supabaseClient, caseId, 'System', 'Configuration', 'AI Model Switch', `Switched to ${newAiModel}.`, 'processing');
      if (newAiModel === 'openai') {
        const { data: caseData } = await supabaseClient.from('cases').select('openai_assistant_id').eq('id', caseId).single();
        if (!caseData?.openai_assistant_id) {
          await supabaseClient.functions.invoke('start-analysis', { body: JSON.stringify({ caseId, userId, aiModel: 'openai', fileNames: [] }) });
        }
      }
      await supabaseClient.functions.invoke('ai-orchestrator', { body: JSON.stringify({ caseId, command: 're_run_analysis', payload: {} }), headers: { 'x-supabase-user-id': userId } });
      return new Response(JSON.stringify({ message: `Switched to ${newAiModel} and started re-analysis.` }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
    }

    const { data: caseData, error: caseError } = await supabaseClient.from('cases').select('ai_model, openai_thread_id, openai_assistant_id, gemini_chat_history').eq('id', caseId).single();
    if (caseError || !caseData) throw new Error('Case not found or error fetching case details.');

    const { ai_model, openai_thread_id, openai_assistant_id, gemini_chat_history } = caseData;
    let responseMessage = '';

    if (ai_model === 'openai') {
      if (!openai_thread_id || !openai_assistant_id) throw new Error('OpenAI thread or assistant ID missing.');
      const openai = new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY') });
      responseMessage = await handleOpenAICommand(supabaseClient, openai, caseId, userId, command, payload, openai_thread_id, openai_assistant_id);
    } else if (ai_model === 'gemini') {
      responseMessage = await handleGeminiCommand(supabaseClient, caseId, command, payload, gemini_chat_history || []);
    } else {
      throw new Error(`Unsupported AI model: ${ai_model}`);
    }

    return new Response(JSON.stringify({ message: responseMessage, caseId }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
  } catch (error: any) {
    console.error('Edge Function error:', error.message);
    return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 });
  }
});