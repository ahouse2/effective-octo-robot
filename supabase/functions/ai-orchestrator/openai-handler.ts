import OpenAI from 'https://esm.sh/openai@4.52.7';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { extractJsonFromMarkdown } from './utils/helpers.ts';

interface CaseDetails {
  case_id: string;
  openai_thread_id: string;
  openai_assistant_id: string;
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

const openai = new OpenAI({
  apiKey: Deno.env.get('OPENAI_API_KEY'),
});

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

// Function to poll for run completion and handle tool calls
async function pollRun(threadId: string, runId: string, caseId: string) {
  let runStatus = 'in_progress';
  while (runStatus === 'queued' || runStatus === 'in_progress' || runStatus === 'cancelling' || runStatus === 'requires_action') {
    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for 1 second
    const retrievedRun = await openai.beta.threads.runs.retrieve(threadId, runId);
    runStatus = retrievedRun.status;
    console.log(`OpenAI Run Status: ${runStatus}`);

    if (runStatus === 'requires_action' && retrievedRun.required_action?.type === 'submit_tool_outputs') {
      const toolOutputs: { tool_call_id: string; output: string }[] = [];
      for (const toolCall of retrievedRun.required_action.submit_tool_outputs.tool_calls) {
        if (toolCall.function.name === 'web_search') {
          console.log('OpenAI requested web_search tool:', toolCall.function.arguments);
          await supabaseClient.from('agent_activities').insert({
            case_id: caseId,
            agent_name: 'OpenAI Assistant',
            agent_role: 'Tool Executor',
            activity_type: 'Web Search Initiated',
            content: `Performing web search for: ${toolCall.function.arguments}`,
            status: 'processing',
          });

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
            toolOutputs.push({ tool_call_id: toolCall.id, output: output });
            await supabaseClient.from('agent_activities').insert({
              case_id: caseId,
              agent_name: 'Web Search Agent',
              agent_role: 'Tool Executor',
              activity_type: 'Web Search Completed',
              content: `Web search completed. Results: ${output.substring(0, 200)}...`,
              status: 'completed',
            });
          } catch (toolError: any) {
            console.error('Error executing web_search tool:', toolError);
            toolOutputs.push({ tool_call_id: toolCall.id, output: `Error: ${toolError.message}` });
            await supabaseClient.from('agent_activities').insert({
              case_id: caseId,
              agent_name: 'Web Search Agent',
              agent_role: 'Error Handler',
              activity_type: 'Web Search Failed',
              content: `Web search failed: ${toolError.message}`,
              status: 'error',
            });
          }
        } else if (toolCall.function.name === 'file_search') {
          console.log('OpenAI requested file_search tool:', toolCall.function.arguments);
          toolOutputs.push({ tool_call_id: toolCall.id, output: `File search tool not fully implemented yet. Query: ${toolCall.function.arguments}` });
          await supabaseClient.from('agent_activities').insert({
            case_id: caseId,
            agent_name: 'OpenAI Assistant',
            agent_role: 'Tool Executor',
            activity_type: 'File Search Note',
            content: `File search tool requested but not fully implemented. Query: ${toolCall.function.arguments}`,
            status: 'processing',
          });
        } else {
          console.warn(`Unknown tool call: ${toolCall.function.name}`);
          toolOutputs.push({ tool_call_id: toolCall.id, output: `Unknown tool: ${toolCall.function.name}` });
        }
      }

      if (toolOutputs.length > 0) {
        await openai.beta.threads.runs.submitToolOutputs(threadId, runId, { tool_outputs: toolOutputs });
      }
    }
  }
  return runStatus;
}

export async function handleOpenAICommand(command: string, payload: any, caseDetails: CaseDetails) {
  const { case_id, openai_thread_id, openai_assistant_id, userId } = caseDetails;
  let responseMessage = '';

  if (command === 'user_prompt') {
    const { promptContent } = payload;
    console.log(`OpenAI: Processing user prompt for case ${case_id}: "${promptContent}"`);

    await supabaseClient.from('agent_activities').insert({
      case_id: case_id,
      agent_name: 'User',
      agent_role: 'Client',
      activity_type: 'User Prompt',
      content: promptContent,
      status: 'completed',
    });

    await openai.beta.threads.messages.create(
      openai_thread_id,
      {
        role: "user",
        content: promptContent,
      }
    );

    const run = await openai.beta.threads.runs.create(
      openai_thread_id,
      {
        assistant_id: openai_assistant_id,
      }
    );

    const finalStatus = await pollRun(openai_thread_id, run.id, case_id);

    if (finalStatus === 'completed') {
      const messages = await openai.beta.threads.messages.list(openai_thread_id, { order: 'desc', limit: 1 });
      const latestMessage = messages.data[0];

      if (latestMessage && latestMessage.role === 'assistant') {
        const assistantResponse = latestMessage.content.map(block => {
          if (block.type === 'text') {
            return block.text.value;
          }
          return '';
        }).join('\n');

        await updateCaseDataFromAIResponse(case_id, assistantResponse);

        await supabaseClient.from('agent_activities').insert({
          case_id: case_id,
          agent_name: 'OpenAI Assistant',
          agent_role: 'AI',
          activity_type: 'Response',
          content: assistantResponse,
          status: 'completed',
        });
        responseMessage = 'OpenAI Assistant responded.';
      } else {
        await supabaseClient.from('agent_activities').insert({
          case_id: case_id,
          agent_name: 'OpenAI Assistant',
          agent_role: 'AI',
          activity_type: 'No Response',
          content: 'OpenAI Assistant completed run but provided no visible response.',
          status: 'completed',
        });
        responseMessage = 'OpenAI Assistant completed run but no response.';
      }
    } else {
      await supabaseClient.from('agent_activities').insert({
        case_id: case_id,
        agent_name: 'OpenAI Assistant',
        agent_role: 'Error Handler',
        activity_type: 'Run Failed',
        content: `OpenAI Assistant run failed or ended with status: ${finalStatus}`,
        status: 'error',
      });
      throw new Error(`OpenAI Assistant run failed with status: ${finalStatus}`);
    }

  } else if (command === 'process_additional_files') {
    const { newFileNames } = payload;
    console.log(`OpenAI: Processing additional files for case ${case_id}: ${newFileNames.join(', ')}`);

    const openaiFileIds: string[] = [];
    for (const fileName of newFileNames) {
      const filePath = `${userId}/${case_id}/${fileName}`;
      const { data: fileBlob, error: downloadError } = await supabaseClient.storage
        .from('evidence-files')
        .download(filePath);

      if (downloadError) {
        console.error(`Error downloading file ${fileName} from Supabase Storage:`, downloadError);
        await supabaseClient.from('agent_activities').insert({
          case_id: case_id,
          agent_name: 'File Processor',
          agent_role: 'Error Handler',
          activity_type: 'File Download Failed',
          content: `Failed to download ${fileName} from Supabase Storage: ${downloadError.message}`,
          status: 'error',
        });
        throw new Error(`Failed to download file ${fileName}.`);
      }

      if (fileBlob) {
        try {
          const openaiFile = await openai.files.create({
            file: new File([fileBlob], fileName),
            purpose: 'assistants',
          });
          openaiFileIds.push(openaiFile.id);
          await supabaseClient.from('agent_activities').insert({
            case_id: case_id,
            agent_name: 'File Processor',
            agent_role: 'OpenAI Integration',
            activity_type: 'File Uploaded to OpenAI',
            content: `Successfully uploaded ${fileName} to OpenAI (ID: ${openaiFile.id}).`,
            status: 'completed',
          });
        } catch (openaiUploadError: any) {
          console.error(`Error uploading file ${fileName} to OpenAI:`, openaiUploadError);
          await supabaseClient.from('agent_activities').insert({
            case_id: case_id,
            agent_name: 'File Processor',
            agent_role: 'Error Handler',
            activity_type: 'OpenAI File Upload Failed',
            content: `Failed to upload ${fileName} to OpenAI: ${openaiUploadError.message}`,
            status: 'error',
          });
          throw new Error(`Failed to upload file ${fileName} to OpenAI.`);
        }
      }
    }

    await openai.beta.threads.messages.create(
      openai_thread_id,
      {
        role: "user",
        content: `New files have been uploaded for analysis: ${newFileNames.join(', ')}. Please incorporate them into your ongoing analysis.`,
        attachments: openaiFileIds.map(fileId => ({ file_id: fileId, tools: [{ type: "file_search" }] })),
      }
    );

    const run = await openai.beta.threads.runs.create(
      openai_thread_id,
      {
        assistant_id: openai_assistant_id,
      }
    );

    const finalStatus = await pollRun(openai_thread_id, run.id, case_id);

    if (finalStatus === 'completed') {
      await supabaseClient.from('agent_activities').insert({
        case_id: case_id,
        agent_name: 'OpenAI Assistant',
        agent_role: 'AI',
        activity_type: 'New Files Processed',
        content: 'OpenAI Assistant has processed the newly uploaded files.',
        status: 'completed',
      });
      responseMessage = 'OpenAI Assistant processed new files.';
    } else {
      await supabaseClient.from('agent_activities').insert({
        case_id: case_id,
        agent_name: 'OpenAI Assistant',
        agent_role: 'Error Handler',
        activity_type: 'New File Processing Failed',
        content: `OpenAI Assistant run for new files failed or ended with status: ${finalStatus}`,
        status: 'error',
      });
      throw new Error(`OpenAI Assistant run for new files failed with status: ${finalStatus}`);
    }
  } else if (command === 'web_search') {
    const { query } = payload;
    console.log(`OpenAI: Performing web search for case ${case_id} with query: "${query}"`);

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

    await openai.beta.threads.messages.create(
      openai_thread_id,
      {
        role: "user",
        content: `Web search results for "${query}":\n\`\`\`json\n${searchContent}\n\`\`\`\nPlease analyze these results and incorporate them into your case theory or provide relevant insights.`,
      }
    );

    const run = await openai.beta.threads.runs.create(
      openai_thread_id,
      {
        assistant_id: openai_assistant_id,
      }
    );

    const finalStatus = await pollRun(openai_thread_id, run.id, case_id);

    if (finalStatus === 'completed') {
      const messages = await openai.beta.threads.messages.list(openai_thread_id, { order: 'desc', limit: 1 });
      const latestMessage = messages.data[0];

      if (latestMessage && latestMessage.role === 'assistant') {
        const assistantResponse = latestMessage.content.map(block => {
          if (block.type === 'text') {
            return block.text.value;
          }
          return '';
        }).join('\n');

        await updateCaseDataFromAIResponse(case_id, assistantResponse);

        await supabaseClient.from('agent_activities').insert({
          case_id: case_id,
          agent_name: 'OpenAI Assistant',
          agent_role: 'AI',
          activity_type: 'Response (Web Search)',
          content: assistantResponse,
          status: 'completed',
        });
        responseMessage = 'OpenAI Assistant processed web search results.';
      } else {
        await supabaseClient.from('agent_activities').insert({
          case_id: case_id,
          agent_name: 'OpenAI Assistant',
          agent_role: 'AI',
          activity_type: 'No Response (Web Search)',
          content: 'OpenAI Assistant completed run for web search but provided no visible response.',
          status: 'completed',
        });
        responseMessage = 'OpenAI Assistant completed run for web search but no response.';
      }
    } else {
      await supabaseClient.from('agent_activities').insert({
        case_id: case_id,
        agent_name: 'OpenAI Assistant',
        agent_role: 'Error Handler',
        activity_type: 'Web Search Processing Failed',
        content: `OpenAI Assistant run for web search failed or ended with status: ${finalStatus}`,
        status: 'error',
      });
      throw new Error(`OpenAI Assistant run for web search failed with status: ${finalStatus}`);
    }
  } else {
    throw new Error(`Unsupported command for OpenAI: ${command}`);
  }

  return responseMessage;
}