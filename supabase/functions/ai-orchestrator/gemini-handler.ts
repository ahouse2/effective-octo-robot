import { GoogleGenerativeAI } from 'https://esm.sh/@google/generative-ai@0.15.0';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { extractJsonFromMarkdown } from './utils/helpers.ts';

interface CaseDetails {
  case_id: string;
  gemini_chat_history: any[];
  userId: string;
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

const genAI = new GoogleGenerativeAI(Deno.env.get('GOOGLE_GEMINI_API_KEY') ?? '');
const model = genAI.getGenerativeModel({ model: "gemini-pro" });

// Helper to update case theory and insights
async function updateCaseDataFromAIResponse(caseId: string, responseContent: string) {
  const structuredData = extractJsonFromMarkdown(responseContent);

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

export async function handleGeminiCommand(command: string, payload: any, caseDetails: CaseDetails) {
  const { case_id, gemini_chat_history } = caseDetails;
  let responseMessage = '';

  const chat = model.startChat({
    history: gemini_chat_history || [],
    generationConfig: {
      maxOutputTokens: 2048,
    },
  });

  if (command === 'user_prompt') {
    const { promptContent } = payload;
    console.log(`Gemini: Processing user prompt for case ${case_id}: "${promptContent}"`);

    await supabaseClient.from('agent_activities').insert({
      case_id: case_id,
      agent_name: 'User',
      agent_role: 'Client',
      activity_type: 'User Prompt',
      content: promptContent,
      status: 'completed',
    });

    try {
      const result = await chat.sendMessage(promptContent);
      const response = await result.response;
      const text = response.text();

      const updatedChatHistory = [...(gemini_chat_history || []),
        { role: 'user', parts: [{ text: promptContent }] },
        { role: 'model', parts: [{ text: text }] }
      ];
      await supabaseClient.from('cases').update({ gemini_chat_history: updatedChatHistory }).eq('id', case_id);

      await updateCaseDataFromAIResponse(case_id, text);

      await supabaseClient.from('agent_activities').insert({
        case_id: case_id,
        agent_name: 'Google Gemini',
        agent_role: 'AI',
        activity_type: 'Response',
        content: text,
        status: 'completed',
      });
      responseMessage = 'Google Gemini responded.';
    } catch (geminiError: any) {
      console.error('Error interacting with Gemini:', geminiError);
      await supabaseClient.from('agent_activities').insert({
        case_id: case_id,
        agent_name: 'Google Gemini',
        agent_role: 'Error Handler',
        activity_type: 'Gemini Interaction Failed',
        content: `Failed to get response from Gemini: ${geminiError.message}`,
        status: 'error',
      });
      throw new Error(`Failed to get response from Gemini: ${geminiError.message}`);
    }

  } else if (command === 'process_additional_files') {
    const { newFileNames } = payload;
    console.log(`Gemini: Processing additional files for case ${case_id}: ${newFileNames.join(', ')}`);

    const content = `New files (${newFileNames.join(', ')}) have been uploaded to storage for this case. Google Gemini currently does not support direct document analysis without a Retrieval Augmented Generation (RAG) setup. These files are available for future RAG integration but will not be analyzed by Gemini at this time.`;
    
    await supabaseClient.from('agent_activities').insert({
      case_id: case_id,
      agent_name: 'Google Gemini',
      agent_role: 'File Processor',
      activity_type: 'File Processing Note',
      content: content,
      status: 'completed',
    });

    const updatedChatHistory = [...(gemini_chat_history || []),
      { role: 'model', parts: [{ text: content }] }
    ];
    await supabaseClient.from('cases').update({ gemini_chat_history: updatedChatHistory }).eq('id', case_id);

    responseMessage = 'Gemini noted new files, RAG setup required for analysis.';
  } else if (command === 'web_search') {
    const { query } = payload;
    console.log(`Gemini: Performing web search for case ${case_id} with query: "${query}"`);

    const { data: searchResult, error: searchError } = await supabaseClient.functions.invoke(
      'web-search',
      {
        body: JSON.stringify({ query: query }),
        headers: { 'Content-Type': 'application/json' },
      }
    );

    if (searchError) {
      console.error('Error invoking web-search function:', searchError);
      await supabaseClient.from('agent_activities').insert({
        case_id: case_id,
        agent_name: 'Web Search Agent',
        agent_role: 'Error Handler',
        activity_type: 'Web Search Failed',
        content: `Failed to perform web search: ${searchError.message}`,
        status: 'error',
      });
      throw new Error(`Failed to perform web search: ${searchError.message}`);
    }

    const searchContent = searchResult?.results ? JSON.stringify(searchResult.results, null, 2) : 'No results found.';

    const geminiPrompt = `I performed a web search for "${query}". Here are the results:\n\`\`\`json\n${searchContent}\n\`\`\`\nPlease analyze these results and incorporate them into your case theory or provide relevant insights.`;
    
    try {
      const result = await chat.sendMessage(geminiPrompt);
      const response = await result.response;
      const text = response.text();

      const updatedChatHistory = [...(gemini_chat_history || []),
        { role: 'user', parts: [{ text: geminiPrompt }] },
        { role: 'model', parts: [{ text: text }] }
      ];
      await supabaseClient.from('cases').update({ gemini_chat_history: updatedChatHistory }).eq('id', case_id);

      await updateCaseDataFromAIResponse(case_id, text);

      await supabaseClient.from('agent_activities').insert({
        case_id: case_id,
        agent_name: 'Google Gemini',
        agent_role: 'AI',
        activity_type: 'Response (Web Search)',
        content: text,
        status: 'completed',
      });
      responseMessage = 'Google Gemini processed web search results.';
    } catch (geminiError: any) {
      console.error('Error interacting with Gemini after web search:', geminiError);
      await supabaseClient.from('agent_activities').insert({
        case_id: case_id,
        agent_name: 'Google Gemini',
        agent_role: 'Error Handler',
        activity_type: 'Gemini Web Search Processing Failed',
        content: `Failed to process web search results with Gemini: ${geminiError.message}`,
        status: 'error',
      });
      throw new Error(`Failed to process web search results with Gemini: ${geminiError.message}`);
    }
  } else {
    throw new Error(`Unsupported command for Gemini: ${command}`);
  }

  return responseMessage;
}