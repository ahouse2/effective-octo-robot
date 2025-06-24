import OpenAI from 'https://esm.sh/openai@4.52.7';
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { insertAgentActivity, updateCaseData } from './commonUtils.ts';

// Helper function to handle individual tool calls
async function handleToolCall(
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
    // OpenAI's file_search tool is handled internally by the Assistant.
    // We just need to acknowledge the tool call and return an empty output.
    await insertAgentActivity(supabaseClient, caseId, 'OpenAI Assistant', 'Tool Executor', 'File Search Initiated', `OpenAI Assistant is performing an internal file search. Query: ${toolCall.function.arguments}`, 'processing');
    return { tool_call_id: toolCall.id, output: "" }; // Empty output for internal tools
  } else {
    console.warn(`Unknown tool call: ${toolCall.function.name}`);
    return { tool_call_id: toolCall.id, output: `Unknown tool: ${toolCall.function.name}` };
  }
}

// Function to poll for OpenAI run completion and handle tool calls
export async function pollOpenAIRun(
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
        (toolCall: any) => handleToolCall(supabaseClient, caseId, toolCall)
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
export async function uploadFilesToOpenAI(
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
export async function handleOpenAICommand(
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
  } else {
    throw new Error(`Unsupported command for OpenAI: ${command}`);
  }
  return responseMessage;
}