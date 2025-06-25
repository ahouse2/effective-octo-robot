import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import OpenAI from 'https://esm.sh/openai@4.52.7';
import { GoogleGenerativeAI } from 'https://esm.sh/@google/generative-ai@0.15.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// --- commonUtils.ts content (inlined) ---
// Helper function to extract JSON from markdown code blocks
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

// Helper function to update case theory and insights
async function updateCaseData(supabaseClient: SupabaseClient, caseId: string, assistantResponse: string) {
  const structuredData = extractJsonFromMarkdown(assistantResponse);

  if (structuredData) {
    if (structuredData.theory_update) {
      const { error: theoryUpdateError } = await supabaseClient
        .from('case_theories')
        .update({
          fact_patterns: structuredData.theory_update.fact_patterns,
          legal_arguments: structuredData.theory_update.legal_arguments,
          potential_outcomes: structuredData.theory_update.potential_outcomes,
          status: structuredData.theory_update.status,
          last_updated: new Date().toISOString(),
        })
        .eq('case_id', caseId);
      if (theoryUpdateError) console.error('Error updating case theory:', theoryUpdateError);
    }
    if (structuredData.insights && Array.isArray(structuredData.insights)) {
      for (const insight of structuredData.insights) {
        const { error: insightInsertError } = await supabaseClient
          .from('case_insights')
          .insert({
            case_id: caseId,
            title: insight.title,
            description: insight.description,
            insight_type: insight.insight_type || 'general',
            timestamp: new Date().toISOString(),
          });
        if (insightInsertError) console.error('Error inserting case insight:', insightInsertError);
      }
    }
  }
}

// Helper function to insert agent activities
async function insertAgentActivity(
  supabaseClient: SupabaseClient,
  caseId: string,
  agentName: string,
  agentRole: string,
  activityType: string,
  content: string,
  status: 'processing' | 'completed' | 'error'
) {
  const { error } = await supabaseClient
    .from('agent_activities')
    .insert({
      case_id: caseId,
      agent_name: agentName,
      agent_role: agentRole,
      activity_type: activityType,
      content: content,
      status: status,
      timestamp: new Date().toISOString(),
    });
  if (error) {
    console.error(`Error inserting agent activity (${activityType}):`, error);
  }
}

// --- openaiHandler.ts content (inlined) ---
// Helper function to handle individual tool calls
async function handleOpenAIToolCall(
  supabaseClient: SupabaseClient,
  caseId: string,
  toolCall: any
): Promise<{ tool_call_id: string; output: string }> {
  if (toolCall.function.name === 'web_search') {
    console.log('OpenAI requested web_search tool:', toolCall.function.arguments);
    await insertAgentActivity(supabaseClient, caseId, 'OpenAI Assistant', 'Tool Executor', 'Web Search Initiated', `Performing web search for: ${toolCall.function.arguments}`, 'processing');

    try {
      const args = JSON.parse(toolCall.function.arguments);
      const { data: searchResult, error: searchError } = await supabaseClient.functions.invoke(
        'web-search',
        {
          body: JSON.stringify({ query: args.query }),
          headers: { 'Content-Type': 'application/json' },
        }
      );

      if (searchError) {
        throw new Error(`Web search failed: ${searchError.message}`);
      }
      const output = JSON.stringify(searchResult?.results || []);
      await insertAgentActivity(supabaseClient, caseId, 'Web Search Agent', 'Tool Executor', 'Web Search Completed', `Web search completed. Results: ${output.substring(0, 200)}...`, 'completed');
      return { tool_call_id: toolCall.id, output: output };
    } catch (toolError: any) {
      console.error('Error executing web_search tool:', toolError);
      await insertAgentActivity(supabaseClient, caseId, 'Web Search Agent', 'Error Handler', 'Web Search Failed', `Web search failed: ${toolError.message}`, 'error');
      return { tool_call_id: toolCall.id, output: `Error: ${toolError.message}` };
    }
  } else if (toolCall.function.name === 'file_search') {
    console.log('OpenAI requested file_search tool:', toolCall.function.arguments);
    await insertAgentActivity(supabaseClient, caseId, 'OpenAI Assistant', 'Tool Executor', 'File Search Initiated', `OpenAI Assistant is performing an internal file search. Query: ${toolCall.function.arguments}`, 'processing');
    return { tool_call_id: toolCall.id, output: "" }; // Empty output for internal tools
  } else {
    console.warn(`Unknown tool call: ${toolCall.function.name}`);
    return { tool_call_id: toolCall.id, output: `Unknown tool: ${toolCall.function.name}` };
  }
}

// Function to poll for OpenAI run completion and handle tool calls
async function pollOpenAIRun(
  openai: OpenAI,
  supabaseClient: SupabaseClient,
  caseId: string,
  threadId: string,
  runId: string
): Promise<string> {
  let runStatus = 'in_progress';
  while (runStatus === 'queued' || runStatus === 'in_progress' || runStatus === 'cancelling' || runStatus === 'requires_action') {
    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for 1 second
    const retrievedRun = await openai.beta.threads.runs.retrieve(threadId, runId);
    runStatus = retrievedRun.status;
    console.log(`OpenAI Run Status: ${runStatus}`);

    if (runStatus === 'requires_action' && retrievedRun.required_action?.type === 'submit_tool_outputs') {
      const toolOutputsPromises = retrievedRun.required_action.submit_tool_outputs.tool_calls.map(
        (toolCall: any) => handleOpenAIToolCall(supabaseClient, caseId, toolCall)
      );
      const toolOutputs = await Promise.all(toolOutputsPromises);

      if (toolOutputs.length > 0) {
        await openai.beta.threads.runs.submitToolOutputs(threadId, runId, { tool_outputs: toolOutputs });
      }
    }
  }
  return runStatus;
}

// Helper function to upload files to OpenAI
async function uploadFilesToOpenAI(
  supabaseClient: SupabaseClient,
  openai: OpenAI,
  caseId: string,
  userId: string,
  fileNames: string[]
): Promise<string[]> {
  const openaiFileIds: string[] = [];
  for (const fileName of fileNames) {
    const filePath = `${userId}/${caseId}/${fileName}`;
    const { data: fileBlob, error: downloadError } = await supabaseClient.storage
      .from('evidence-files')
      .download(filePath);

    if (downloadError) {
      console.error(`Error downloading file ${fileName} from Supabase Storage:`, downloadError);
      await insertAgentActivity(supabaseClient, caseId, 'File Processor', 'Error Handler', 'File Download Failed', `Failed to download ${fileName} from Supabase Storage: ${downloadError.message}`, 'error');
      throw new Error(`Failed to download file ${fileName}.`);
    }

    if (fileBlob) {
      try {
        const openaiFile = await openai.files.create({
          file: new File([fileBlob], fileName),
          purpose: 'assistants',
        });
        openaiFileIds.push(openaiFile.id);
        await insertAgentActivity(supabaseClient, caseId, 'File Processor', 'OpenAI Integration', 'File Uploaded to OpenAI', `Successfully uploaded ${fileName} to OpenAI (ID: ${openaiFile.id}).`, 'completed');
      } catch (openaiUploadError: any) {
        console.error(`Error uploading file ${fileName} to OpenAI:`, openaiUploadError);
        await insertAgentActivity(supabaseClient, caseId, 'File Processor', 'Error Handler', 'OpenAI File Upload Failed', `Failed to upload ${fileName} to OpenAI: ${openaiUploadError.message}`, 'error');
        throw new Error(`Failed to upload file ${fileName} to OpenAI.`);
      }
    }
  }
  return openaiFileIds;
}

// Main OpenAI Handler
async function handleOpenAICommand(
  supabaseClient: SupabaseClient,
  openai: OpenAI,
  caseId: string,
  userId: string,
  command: string,
  payload: any,
  openaiThreadId: string,
  openaiAssistantId: string
): Promise<string> {
  let responseMessage = '';

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

  if (command === 'user_prompt') {
    const { promptContent } = payload;
    console.log(`OpenAI: Processing user prompt for case ${caseId}: "${promptContent}"`);

    await openai.beta.threads.messages.create(
      openaiThreadId,
      {
        role: "user",
        content: promptContent,
      }
    );

    const run = await openai.beta.threads.runs.create(
      openaiThreadId,
      {
        assistant_id: openaiAssistantId,
      }
    );

    const finalStatus = await pollOpenAIRun(openai, supabaseClient, caseId, openaiThreadId, run.id);

    if (finalStatus === 'completed') {
      const messages = await openai.beta.threads.messages.list(openaiThreadId, { order: 'desc', limit: 1 });
      const latestMessage = messages.data[0];

      if (latestMessage && latestMessage.role === 'assistant') {
        const assistantResponse = latestMessage.content.map(block => {
          if (block.type === 'text') {
            return block.text.value;
          }
          return '';
        }).join('\n');

        await updateCaseData(supabaseClient, caseId, assistantResponse);
        await insertAgentActivity(supabaseClient, caseId, 'OpenAI Assistant', 'AI', 'Response', assistantResponse, 'completed');
        responseMessage = 'OpenAI Assistant responded.';
      } else {
        await insertAgentActivity(supabaseClient, caseId, 'OpenAI Assistant', 'AI', 'No Response', 'OpenAI Assistant completed run but provided no visible response.', 'completed');
        responseMessage = 'OpenAI Assistant completed run but no response.';
      }
    } else {
      await insertAgentActivity(supabaseClient, caseId, 'OpenAI Assistant', 'Error Handler', 'Run Failed', `OpenAI Assistant run failed or ended with status: ${finalStatus}`, 'error');
      throw new Error(`OpenAI Assistant run failed with status: ${finalStatus}`);
    }

  } else if (command === 'process_additional_files') {
    const { newFileNames } = payload;
    console.log(`OpenAI: Processing additional files for case ${caseId}: ${newFileNames.join(', ')}`);

    const openaiFileIds = await uploadFilesToOpenAI(supabaseClient, openai, caseId, userId, newFileNames);

    await openai.beta.threads.messages.create(
      openaiThreadId,
      {
        role: "user",
        content: `New files have been uploaded for analysis: ${newFileNames.join(', ')}. Please incorporate them into your ongoing analysis.`,
        attachments: openaiFileIds.map(fileId => ({ file_id: fileId, tools: [{ type: "file_search" }] })),
      }
    );

    const run = await openai.beta.threads.runs.create(
      openaiThreadId,
      {
        assistant_id: openaiAssistantId,
      }
    );

    const finalStatus = await pollOpenAIRun(openai, supabaseClient, caseId, openaiThreadId, run.id);

    if (finalStatus === 'completed') {
      await insertAgentActivity(supabaseClient, caseId, 'OpenAI Assistant', 'AI', 'New Files Processed', 'OpenAI Assistant has processed the newly uploaded files.', 'completed');
      responseMessage = 'OpenAI Assistant processed new files.';
    } else {
      await insertAgentActivity(supabaseClient, caseId, 'OpenAI Assistant', 'Error Handler', 'New File Processing Failed', `OpenAI Assistant run for new files failed or ended with status: ${finalStatus}`, 'error');
      throw new Error(`OpenAI Assistant run for new files failed with status: ${finalStatus}`);
    }
  } else if (command === 'web_search') {
    const { query } = payload;
    console.log(`OpenAI: Performing web search for case ${caseId} with query: "${query}"`);

    const { data: searchResult, error: searchError } = await supabaseClient.functions.invoke(
      'web-search',
      {
        body: JSON.stringify({ query: query }),
        headers: { 'Content-Type': 'application/json' },
      }
    );

    if (searchError) {
      console.error('Error invoking web-search function:', searchError);
      await insertAgentActivity(supabaseClient, caseId, 'Web Search Agent', 'Error Handler', 'Web Search Failed', `Failed to perform web search: ${searchError.message}`, 'error');
      throw new Error(`Failed to perform web search: ${searchError.message}`);
    }

    const searchContent = searchResult?.results ? JSON.stringify(searchResult.results, null, 2) : 'No results found.';

    await openai.beta.threads.messages.create(
      openaiThreadId,
      {
        role: "user",
        content: `Web search results for "${query}":\n\`\`\`json\n${searchContent}\n\`\`\`\nPlease analyze these results and incorporate them into your case theory or provide relevant insights.`,
      }
    );

    const run = await openai.beta.threads.runs.create(
      openaiThreadId,
      {
        assistant_id: openaiAssistantId,
      }
    );

    const finalStatus = await pollOpenAIRun(openai, supabaseClient, caseId, openaiThreadId, run.id);

    if (finalStatus === 'completed') {
      const messages = await openai.beta.threads.messages.list(openaiThreadId, { order: 'desc', limit: 1 });
      const latestMessage = messages.data[0];

      if (latestMessage && latestMessage.role === 'assistant') {
        const assistantResponse = latestMessage.content.map(block => {
          if (block.type === 'text') {
            return block.text.value;
          }
          return '';
        }).join('\n');

        await updateCaseData(supabaseClient, caseId, assistantResponse);
        await insertAgentActivity(supabaseClient, caseId, 'OpenAI Assistant', 'AI', 'Response (Web Search)', assistantResponse, 'completed');
        responseMessage = 'OpenAI Assistant processed web search results.';
      } else {
        await insertAgentActivity(supabaseClient, caseId, 'OpenAI Assistant', 'AI', 'No Response (Web Search)', 'OpenAI Assistant completed run for web search but provided no visible response.', 'completed');
        responseMessage = 'OpenAI Assistant completed run for web search but no response.';
      }
    } else {
      await insertAgentActivity(supabaseClient, caseId, 'OpenAI Assistant', 'Error Handler', 'Web Search Processing Failed', `OpenAI Assistant run for web search failed or ended with status: ${finalStatus}`, 'error');
      throw new Error(`OpenAI Assistant run for web search failed with status: ${finalStatus}`);
    }
  } else if (command === 'update_assistant_instructions') {
    console.log(`OpenAI: Updating assistant instructions for case ${caseId}`);

    const { data: caseData, error: caseFetchError } = await supabaseClient
      .from('cases')
      .select('case_goals, system_instruction')
      .eq('id', caseId)
      .single();

    if (caseFetchError || !caseData) {
      console.error('Error fetching case data for instruction update:', caseFetchError);
      throw new Error('Case not found or error fetching case details for instruction update.');
    }

    const newInstructions = `You are a specialized AI assistant for California family law cases. Your primary goal is to analyze evidence, identify key facts, legal arguments, and potential outcomes. You should be precise, objective, and focus on the legal implications of the provided documents. Always cite the source document when making claims.
            
User's Case Goals: ${caseData.case_goals || 'Not specified.'}
User's System Instruction: ${caseData.system_instruction || 'None provided.'}
            
When responding, provide updates on your analysis progress, key findings, and any questions you have.
${structuredOutputInstruction}`;

    try {
      await openai.beta.assistants.update(openaiAssistantId, {
        instructions: newInstructions,
      });
      await insertAgentActivity(supabaseClient, caseId, 'OpenAI Assistant', 'Configuration', 'Instructions Updated', 'OpenAI Assistant instructions updated successfully.', 'completed');
      responseMessage = 'OpenAI Assistant instructions updated.';
    } catch (updateError: any) {
      console.error('Error updating OpenAI Assistant instructions:', updateError);
      await insertAgentActivity(supabaseClient, caseId, 'OpenAI Assistant', 'Error Handler', 'Instructions Update Failed', `Failed to update OpenAI Assistant instructions: ${updateError.message}`, 'error');
      throw new Error(`Failed to update OpenAI Assistant instructions: ${updateError.message}`);
    }
  } else {
    throw new Error(`Unsupported command for OpenAI: ${command}`);
  }
  return responseMessage;
}

// --- geminiHandler.ts content (inlined) ---
// Main Gemini Handler
async function handleGeminiCommand(
  supabaseClient: SupabaseClient,
  caseId: string,
  command: string,
  payload: any,
  geminiChatHistory: any[]
): Promise<string> {
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
    const { promptContent } = payload;
    console.log(`Gemini: Processing user prompt for case ${caseId}: "${promptContent}"`);

    try {
      const result = await chat.sendMessage(promptContent);
      const response = await result.response;
      const text = response.text();

      const updatedChatHistory = [...(geminiChatHistory || []),
        { role: 'user', parts: [{ text: promptContent }] },
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

  } else if (command === 'process_additional_files') {
    const { newFileNames } = payload;
    console.log(`Gemini: Processing additional files for case ${caseId}: ${newFileNames.join(', ')}`);

    const content = `New files (${newFileNames.join(', ')}) have been uploaded to storage for this case. Google Gemini currently does not support direct document analysis without a Retrieval Augmented Generation (RAG) setup. These files are available for future RAG integration but will not be analyzed by Gemini at this time.`;
    
    await insertAgentActivity(supabaseClient, caseId, 'Google Gemini', 'File Processor', 'File Processing Note', content, 'completed');

    const updatedChatHistory = [...(geminiChatHistory || []),
      { role: 'model', parts: [{ text: content }] }
    ];
    await supabaseClient.from('cases').update({ gemini_chat_history: updatedChatHistory }).eq('id', caseId);

    responseMessage = 'Gemini noted new files, RAG setup required for analysis.';
  } else if (command === 'web_search') {
    const { query } = payload;
    console.log(`Gemini: Performing web search for case ${caseId} with query: "${query}"`);

    const { data: searchResult, error: searchError } = await supabaseClient.functions.invoke(
      'web-search',
      {
        body: JSON.stringify({ query: query }),
        headers: { 'Content-Type': 'application/json' },
      }
    );

    if (searchError) {
      console.error('Error invoking web-search function:', searchError);
      await insertAgentActivity(supabaseClient, caseId, 'Web Search Agent', 'Error Handler', 'Web Search Failed', `Failed to perform web search: ${searchError.message}`, 'error');
      throw new Error(`Failed to perform web search: ${searchError.message}`);
    }

    const searchContent = searchResult?.results ? JSON.stringify(searchResult.results, null, 2) : 'No results found.';

    const geminiPrompt = `I performed a web search for "${query}". Here are the results:\n\`\`\`json\n${searchContent}\n\`\`\`\nPlease analyze these results and incorporate them into your case theory or provide relevant insights.`;
    
    try {
      const result = await chat.sendMessage(geminiPrompt);
      const response = await result.response;
      const text = response.text();

      const updatedChatHistory = [...(geminiChatHistory || []),
        { role: 'user', parts: [{ text: geminiPrompt }] },
        { role: 'model', parts: [{ text: text }] }
      ];
      await supabaseClient.from('cases').update({ gemini_chat_history: updatedChatHistory }).eq('id', caseId);

      await updateCaseData(supabaseClient, caseId, text);
      await insertAgentActivity(supabaseClient, caseId, 'Google Gemini', 'AI', 'Response (Web Search)', text, 'completed');
      responseMessage = 'Google Gemini processed web search results.';
    } catch (geminiError: any) {
      console.error('Error interacting with Gemini after web search:', geminiError);
      await insertAgentActivity(supabaseClient, caseId, 'Google Gemini', 'Error Handler', 'Gemini Web Search Processing Failed', `Failed to process web search results with Gemini: ${geminiError.message}`, 'error');
      throw new Error(`Failed to process web search results with Gemini: ${geminiError.message}`);
    }
  } else if (command === 'update_assistant_instructions') {
    console.log(`Gemini: Case directives updated for case ${caseId}. Gemini's instructions are managed via chat history and will adapt to new prompts.`);
    await insertAgentActivity(supabaseClient, caseId, 'Google Gemini', 'Configuration', 'Instructions Noted', 'Gemini instructions are dynamic via chat history; no direct assistant update needed.', 'completed');
    responseMessage = 'Gemini instructions noted.';
  } else {
    throw new Error(`Unsupported command for Gemini: ${command}`);
  }
  return responseMessage;
}


// Main serve function
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { caseId, command, payload } = await req.json();
    const userId = req.headers.get('x-supabase-user-id');

    if (!caseId || !userId || !command || !payload) {
      return new Response(JSON.stringify({ error: 'caseId, userId, command, and payload are required' }), {
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

    const { data: caseData, error: caseError } = await supabaseClient
      .from('cases')
      .select('ai_model, openai_thread_id, openai_assistant_id, gemini_chat_history')
      .eq('id', caseId)
      .single();

    if (caseError || !caseData) {
      console.error('Error fetching case data:', caseError);
      throw new Error('Case not found or error fetching case details.');
    }

    const { ai_model, openai_thread_id, openai_assistant_id, gemini_chat_history } = caseData;

    let responseMessage = '';

    if (ai_model === 'openai') {
      if (!openai_thread_id || !openai_assistant_id) {
        throw new Error('OpenAI thread or assistant ID missing for this case.');
      }
      const openai = new OpenAI({
        apiKey: Deno.env.get('OPENAI_API_KEY'),
      });
      responseMessage = await handleOpenAICommand(
        supabaseClient,
        openai,
        caseId,
        userId,
        command,
        payload,
        openaiThreadId,
        openaiAssistantId
      );
    } else if (ai_model === 'gemini') {
      responseMessage = await handleGeminiCommand(
        supabaseClient,
        caseId,
        command,
        payload,
        gemini_chat_history || []
      );
    } else {
      throw new Error(`Unsupported AI model: ${ai_model}`);
    }

    return new Response(JSON.stringify({ message: responseMessage, caseId }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error: any) {
    console.error('Edge Function error:', error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});