import { GoogleGenerativeAI } from 'https://esm.sh/@google/generative-ai@0.15.0';
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { insertAgentActivity, updateCaseData } from './commonUtils.ts'; // Corrected import path

// Main Gemini Handler
export async function handleGeminiCommand(
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
  } else {
    throw new Error(`Unsupported command for Gemini: ${command}`);
  }
  return responseMessage;
}