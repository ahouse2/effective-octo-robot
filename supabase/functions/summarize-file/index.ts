import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { GoogleGenerativeAI } from 'https://esm.sh/@google/generative-ai@0.15.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const CHUNK_SIZE = 15000; // Characters per chunk
const BATCH_SIZE = 2; // Number of chunks to process in parallel, reduced from 5
const MAX_FILE_SIZE_MB = 50;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

async function fileToGenerativePart(blob: Blob, mimeType: string) {
  const arrayBuffer = await blob.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);
  let binaryString = '';
  for (let i = 0; i < uint8Array.length; i++) {
    binaryString += String.fromCharCode(uint8Array[i]);
  }
  return {
    inlineData: {
      data: btoa(binaryString),
      mimeType,
    },
  };
}

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

async function insertActivity(supabase: SupabaseClient, caseId: string, activity: string, status: 'processing' | 'completed' | 'error' = 'completed') {
    await supabase.from('agent_activities').insert({
        case_id: caseId,
        agent_name: 'Summarizer Agent',
        agent_role: 'File Processor',
        activity_type: 'Summarization',
        content: activity,
        status: status,
    });
}

// New retry helper function for Gemini API calls
async function callGeminiWithRetry<T>(
  geminiCall: () => Promise<T>,
  caseId: string,
  supabaseClient: SupabaseClient,
  activityDescription: string,
  maxRetries = 3,
  initialDelayMs = 5000 // 5 seconds
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await geminiCall();
    } catch (error: any) {
      // Check for 429 Too Many Requests or quota errors
      if (error.status === 429 || (error.message && error.message.includes("quota"))) {
        const currentDelay = initialDelayMs * Math.pow(2, i);
        console.warn(`[Gemini Retry] Rate limit hit for ${activityDescription}. Retrying in ${currentDelay / 1000}s... (Attempt ${i + 1}/${maxRetries})`);
        await insertActivity(supabaseClient, caseId, `[Gemini] Rate limit hit for ${activityDescription}. Retrying in ${currentDelay / 1000}s...`, 'processing');
        await new Promise(resolve => setTimeout(resolve, currentDelay));
      } else {
        // Re-throw other errors immediately
        throw error;
      }
    }
  }
  throw new Error(`[Gemini Retry] Failed to complete ${activityDescription} after ${maxRetries} retries due to persistent rate limits or other issues.`);
}


serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  let caseId: string | null = null;
  let fileId: string | null = null;
  let filePath: string | null = null;
  let fileName: string | null = null;

  try {
    const body = await req.json();
    fileId = body.fileId;
    filePath = body.filePath;
    caseId = body.caseId;

    if (!fileId || !filePath || !caseId) {
      throw new Error("fileId, filePath, and caseId are required.");
    }

    const supabaseClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    
    const pathParts = filePath.split('/');
    fileName = pathParts.pop() || filePath;
    const directoryPath = pathParts.join('/');

    let isSizeMetadataMissing = false;
    let actualFileSize: number | null = null;

    // --- FILE SIZE CHECK ---
    const { data: fileList, error: listError } = await supabaseClient.storage
      .from('evidence-files')
      .list(directoryPath, {
        search: fileName,
        limit: 1,
      });

    if (listError) {
      isSizeMetadataMissing = true;
      await insertActivity(supabaseClient, caseId, `Warning: Could not verify file size due to list error for "${fileName}": ${listError.message}. Attempting summarization anyway.`, 'completed');
    } else if (!fileList || fileList.length === 0 || !fileList[0].metadata || typeof fileList[0].metadata.size === 'undefined' || fileList[0].metadata.size === null) {
      isSizeMetadataMissing = true;
      await insertActivity(supabaseClient, caseId, `Warning: Could not retrieve complete size metadata for file "${fileName}". Attempting summarization anyway.`, 'completed');
    } else {
      actualFileSize = fileList[0].metadata.size;
      if (actualFileSize > MAX_FILE_SIZE_BYTES) {
        const sizeInMB = (actualFileSize / (1024 * 1024)).toFixed(2);
        const skipMessage = `File "${fileName}" (${sizeInMB} MB) is over the ${MAX_FILE_SIZE_MB}MB limit and was skipped. Please review manually.`;
        
        await insertActivity(supabaseClient, caseId, skipMessage, 'completed');
        await supabaseClient.from('case_files_metadata').update({
            description: `File skipped: Exceeds ${MAX_FILE_SIZE_MB}MB size limit (${sizeInMB}MB).`,
            last_modified_at: new Date().toISOString(),
        }).eq('id', fileId);

        return new Response(JSON.stringify({ message: skipMessage }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }
    // --- END FILE SIZE CHECK ---

    const geminiApiKey = Deno.env.get('GOOGLE_GEMINI_API_KEY');
    if (!geminiApiKey) throw new Error("GOOGLE_GEMINI_API_KEY is not set.");

    const genAI = new GoogleGenerativeAI(geminiApiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite-preview-06-17" });

    await insertActivity(supabaseClient, caseId, `Starting summarization for file: ${fileName}`, 'processing');

    const { data: fileBlob, error: downloadError } = await supabaseClient.storage
      .from('evidence-files')
      .download(filePath);

    if (downloadError) throw new Error(`Failed to download file: ${downloadError.message}`);

    const fileBuffer = await fileBlob.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', fileBuffer);
    const fileHash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

    const mimeType = fileBlob.type;
    let finalSummary: any;

    const jsonFormat = `
      {
        "suggested_name": "A concise, descriptive filename like '2023-03-15_Email_from_John_to_Jane.txt'. When suggesting a filename, prioritize clarity and accuracy, ideally reflecting the original file's purpose or content. Infer the correct file extension (e.g., .pdf, .txt, .jpg, .png, .eml) based on the content. Avoid generic binary extensions like '.bin' unless the content is truly unreadable binary data. Avoid terms like 'corrupted' or 'fragment' unless the content explicitly indicates such a state.",
        "description": "A detailed, neutral summary of the document's content and its potential relevance to a family law case.",
        "tags": ["financial", "communication", "custody_dispute"],
        "category": "A single, best-fit category like 'Financial Records', 'Communications', 'Legal Documents', 'Photographic Evidence', or 'Personal Notes'."
      }
    `;

    if (mimeType.startsWith('image/')) {
      const imagePart = await fileToGenerativePart(fileBlob, mimeType);
      const prompt = `Analyze this image in the context of a family law case. Provide a detailed summary, a suggested filename, relevant tags, and a category. Your response MUST be a JSON object inside a markdown block, following this format: ${jsonFormat}`;
      
      const result = await callGeminiWithRetry(
        () => model.generateContent({ contents: [{ role: "user", parts: [{ text: prompt }, imagePart] }] }),
        caseId,
        supabaseClient,
        `image summarization for ${fileName}`
      );
      
      if (result.response.promptFeedback?.blockReason) {
          const reason = result.response.promptFeedback.blockReason;
          const safetyRatings = result.response.promptFeedback.safetyRatings?.map(r => `${r.category}: ${r.probability}`).join(', ');
          throw new Error(`Image summarization blocked by safety filters. Reason: ${reason}. Details: [${safetyRatings}].`);
      }
      finalSummary = extractJson(result.response.text());

    } else if (mimeType === 'application/pdf') { // Handle PDFs by sending the blob directly
      const pdfPart = await fileToGenerativePart(fileBlob, mimeType);
      const prompt = `Analyze this PDF document in the context of a family law case. Attempt to extract all text content, including from scanned images (perform OCR if necessary). If text content is minimal or unreadable, describe the visual content of the document. Then, provide a detailed summary, a suggested filename, relevant tags, and a category. Your response MUST be a JSON object inside a markdown block, following this format: ${jsonFormat}`;
      
      const result = await callGeminiWithRetry(
        () => model.generateContent({ contents: [{ role: "user", parts: [{ text: prompt }, pdfPart] }] }),
        caseId,
        supabaseClient,
        `PDF summarization for ${fileName}`
      );

      if (result.response.promptFeedback?.blockReason) {
          const reason = result.response.promptFeedback.blockReason;
          const safetyRatings = result.response.promptFeedback.safetyRatings?.map(r => `${r.category}: ${r.probability}`).join(', ');
          throw new Error(`PDF summarization blocked by safety filters. Reason: ${reason}. Details: [${safetyRatings}].`);
      }
      finalSummary = extractJson(result.response.text());

    } else if (mimeType.startsWith('text/') || mimeType === 'message/rfc822') { // Keep existing text/email handling
      const textContent = await fileBlob.text();
      
      if (textContent.length < CHUNK_SIZE) {
        await insertActivity(supabaseClient, caseId, `File is small. Summarizing directly.`);
        const prompt = `Analyze this document in the context of a family law case. The document content is below. Provide a detailed summary, a suggested filename, relevant tags, and a category. Your response MUST be a JSON object inside a markdown block, following this format: ${jsonFormat}\n\n---\n\n${textContent}`;
        
        const result = await callGeminiWithRetry(
          () => model.generateContent(prompt),
          caseId,
          supabaseClient,
          `small file summarization for ${fileName}`
        );

        if (result.response.promptFeedback?.blockReason) {
            const reason = result.response.promptFeedback.blockReason;
            const safetyRatings = result.response.promptFeedback.safetyRatings?.map(r => `${r.category}: ${r.probability}`).join(', ');
            throw new Error(`Document summarization blocked by safety filters. Reason: ${reason}. Details: [${safetyRatings}].`);
        }
        finalSummary = extractJson(result.response.text());

      } else {
        await insertActivity(supabaseClient, caseId, `File is large. Starting chunked summarization.`);
        const chunks: string[] = [];
        for (let i = 0; i < textContent.length; i += CHUNK_SIZE) {
          chunks.push(textContent.substring(i, i + CHUNK_SIZE));
        }
        await insertActivity(supabaseClient, caseId, `Split file into ${chunks.length} chunks.`);

        const chunkSummaries: string[] = [];
        for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
            const batchChunks = chunks.slice(i, i + BATCH_SIZE);
            await insertActivity(supabaseClient, caseId, `Summarizing chunks ${i + 1} to ${i + batchChunks.length} (out of ${chunks.length})...`, 'processing');

            const batchPromises = batchChunks.map((chunk, indexInBatch) => {
                const chunkPrompt = `This is one chunk of a larger document. Please summarize this specific chunk concisely, focusing on key names, dates, and actions relevant to a family law case:\n\n---\n\n${chunk}`;
                return callGeminiWithRetry(
                  () => model.generateContent(chunkPrompt),
                  caseId,
                  supabaseClient,
                  `chunk ${i + indexInBatch + 1} summarization for ${fileName}`
                );
            });

            const settledResults = await Promise.allSettled(batchPromises);

            settledResults.forEach((result, index) => {
                if (result.status === 'fulfilled') {
                    const geminiResponse = result.value.response;
                    if (geminiResponse.promptFeedback?.blockReason) {
                        const reason = geminiResponse.promptFeedback.blockReason;
                        console.warn(`Chunk ${i + index} of file "${fileName}" was blocked by safety filters. Reason: ${reason}`);
                        insertActivity(supabaseClient, caseId, `Warning: Chunk ${i + index + 1} of "${fileName}" was blocked by safety filters (Reason: ${reason}). It will be skipped.`, 'completed');
                    } else {
                        chunkSummaries.push(geminiResponse.text());
                    }
                } else {
                    console.error(`Failed to summarize chunk ${i + index} of file "${fileName}":`, result.reason);
                    insertActivity(supabaseClient, caseId, `Error: Failed to summarize chunk ${i + index + 1} of "${fileName}". It will be skipped. Reason: ${result.reason}`, 'error');
                }
            });

            // Add a delay here to avoid hitting rate limits on the next batch
            if (i + BATCH_SIZE < chunks.length) {
                await new Promise(resolve => setTimeout(resolve, 3000));
            }
        }

        if (chunkSummaries.length === 0) {
            // Handle case where all chunks failed to summarize
            const errorMessage = `All chunks failed to summarize for file "${fileName}". Please review the file manually.`;
            await insertActivity(supabaseClient, caseId, errorMessage, 'error');
            await supabaseClient.from('case_files_metadata').update({
                description: `Summarization failed: All chunks failed to process.`,
                last_modified_at: new Date().toISOString(),
            }).eq('id', fileId);
            return new Response(JSON.stringify({ message: errorMessage }), {
                status: 200,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        await insertActivity(supabaseClient, caseId, `All chunks summarized. Creating final combined summary...`, 'processing');
        const combinedSummaries = chunkSummaries.join('\n\n---\n\n');
        const finalPrompt = `You have been provided with several summaries from sequential chunks of a single large document. Your task is to synthesize these into a single, coherent analysis. Based on all the provided information, generate a final JSON object with a suggested filename, a comprehensive description, relevant tags, and a category for the entire document. Your response MUST be a JSON object inside a markdown block, following this format: ${jsonFormat}\n\nHere are the chunk summaries:\n\n${combinedSummaries}`;
        
        const finalResult = await callGeminiWithRetry(
          () => model.generateContent(finalPrompt),
          caseId,
          supabaseClient,
          `final summarization for ${fileName}`
        );

        if (finalResult.response.promptFeedback?.blockReason) {
            const reason = finalResult.response.promptFeedback.blockReason;
            const safetyRatings = finalResult.response.promptFeedback.safetyRatings?.map(r => `${r.category}: ${r.probability}`).join(', ');
            throw new Error(`Final summarization blocked by safety filters. Reason: ${reason}. Details: [${safetyRatings}].`);
        }
        finalSummary = extractJson(finalResult.response.text());
      }
    } else {
      await supabaseClient.from('case_files_metadata').update({
          file_hash: fileHash,
          hash_algorithm: 'SHA-256',
          description: `File type (${mimeType}) not supported for summarization.`,
          last_modified_at: new Date().toISOString(),
      }).eq('id', fileId);
      await insertActivity(supabaseClient, caseId, `File type (${mimeType}) not supported for summarization, but hash was calculated.`);
      return new Response(JSON.stringify({ message: "File hashed but not summarized due to unsupported type." }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (!finalSummary || !finalSummary.description) {
      console.error(`Summarization failed for file "${fileName}". Final summary was:`, finalSummary);
      throw new Error(`AI did not return a valid JSON summary for file "${fileName}". Raw response might be malformed or empty.`);
    }

    const finalDescription = (finalSummary.description || "") + (isSizeMetadataMissing ? " (Note: File size metadata was incomplete.)" : "");

    await supabaseClient.from('case_files_metadata').update({
        description: finalDescription,
        suggested_name: finalSummary.suggested_name,
        tags: finalSummary.tags,
        file_category: finalSummary.category || 'Uncategorized',
        file_hash: fileHash,
        hash_algorithm: 'SHA-256',
        last_modified_at: new Date().toISOString(),
    }).eq('id', fileId);

    await insertActivity(supabaseClient, caseId, `Successfully summarized and hashed file: ${fileName}. New name: ${finalSummary.suggested_name}`);

    return new Response(JSON.stringify({ message: "File summarized and hashed successfully." }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error: any) {
    console.error(`Summarize File Error for ${fileName || filePath || fileId}:`, error.message, error.stack);
    if (caseId && fileId) {
        const supabaseClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
        const errorMessage = `Processing failed for "${fileName || filePath || fileId}": ${error.message}`;
        await insertActivity(supabaseClient, caseId, errorMessage, 'error');
        await supabaseClient.from('case_files_metadata').update({
            description: errorMessage,
            last_modified_at: new Date().toISOString(),
        }).eq('id', fileId);
    }
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});