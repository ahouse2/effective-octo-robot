import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { GoogleGenerativeAI } from 'https://esm.sh/@google/generative-ai@0.15.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function fileToGenerativePart(blob: Blob, mimeType: string) {
  const arrayBuffer = await blob.arrayBuffer();
  return {
    inlineData: {
      data: btoa(String.fromCharCode(...new Uint8Array(arrayBuffer))),
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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { fileId, filePath, caseId } = await req.json();
    if (!fileId || !filePath || !caseId) {
      throw new Error("fileId, filePath, and caseId are required.");
    }

    const supabaseClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    const geminiApiKey = Deno.env.get('GOOGLE_GEMINI_API_KEY');
    if (!geminiApiKey) throw new Error("GOOGLE_GEMINI_API_KEY is not set.");

    const genAI = new GoogleGenerativeAI(geminiApiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-pro" });

    await supabaseClient.from('agent_activities').insert({
        case_id: caseId,
        agent_name: 'Summarizer Agent',
        agent_role: 'File Processor',
        activity_type: 'File Summarization Started',
        content: `Starting summarization for file: ${filePath}`,
        status: 'processing',
    });

    const { data: fileBlob, error: downloadError } = await supabaseClient.storage
      .from('evidence-files')
      .download(filePath);

    if (downloadError) throw new Error(`Failed to download file: ${downloadError.message}`);

    const fileBuffer = await fileBlob.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', fileBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const fileHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    const mimeType = fileBlob.type;
    let prompt;
    let contentParts: any[] = [];

    const jsonFormat = `
      {
        "suggested_name": "A concise, descriptive filename like '2023-03-15_Email_from_John_to_Jane.txt'",
        "description": "A detailed, neutral summary of the document's content and its potential relevance to a family law case.",
        "tags": ["financial", "communication", "custody_dispute"],
        "category": "A single, best-fit category like 'Financial Records', 'Communications', 'Legal Documents', 'Photographic Evidence', or 'Personal Notes'."
      }
    `;

    if (mimeType.startsWith('image/')) {
      const imagePart = await fileToGenerativePart(fileBlob, mimeType);
      prompt = `Analyze this image in the context of a family law case. Provide a detailed summary, a suggested filename, relevant tags, and a category. Your response MUST be a JSON object inside a markdown block, following this format: ${jsonFormat}`;
      contentParts.push(prompt, imagePart);
    } else if (mimeType === 'application/pdf' || mimeType.startsWith('text/')) {
      const textContent = await fileBlob.text();
      prompt = `Analyze this document in the context of a family law case. The document content is below. Provide a detailed summary, a suggested filename, relevant tags, and a category. Your response MUST be a JSON object inside a markdown block, following this format: ${jsonFormat}\n\n---\n\n${textContent}`;
      contentParts.push(prompt);
    } else {
        await supabaseClient.from('case_files_metadata').update({
            file_hash: fileHash,
            hash_algorithm: 'SHA-256',
            description: `File type (${mimeType}) not supported for summarization.`,
            last_modified_at: new Date().toISOString(),
        }).eq('id', fileId);
        
        await supabaseClient.from('agent_activities').insert({
            case_id: caseId,
            agent_name: 'Summarizer Agent',
            agent_role: 'File Processor',
            activity_type: 'File Hashing Complete',
            content: `File type not supported for summarization, but hash was calculated for: ${filePath}.`,
            status: 'completed',
        });

        return new Response(JSON.stringify({ message: "File hashed but not summarized due to unsupported type." }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
        });
    }

    const result = await model.generateContent({ contents: [{ role: "user", parts: contentParts }] });
    const response = result.response;

    if (response.promptFeedback?.blockReason) {
        const blockReason = response.promptFeedback.blockReason;
        const safetyRatings = response.promptFeedback.safetyRatings?.map(r => `${r.category}: ${r.probability}`).join(', ');
        throw new Error(`Summarization for file ${filePath} was blocked for safety reasons. Reason: ${blockReason}. Details: [${safetyRatings}].`);
    }

    const responseText = response.text();
    const parsedJson = extractJson(responseText);

    if (!parsedJson || !parsedJson.description) {
      throw new Error(`Failed to get a valid JSON summary from the AI for file ${filePath}. Response: ${responseText}`);
    }

    const { error: updateError } = await supabaseClient
      .from('case_files_metadata')
      .update({
        description: parsedJson.description,
        suggested_name: parsedJson.suggested_name,
        tags: parsedJson.tags,
        file_category: parsedJson.category || 'Uncategorized',
        file_hash: fileHash,
        hash_algorithm: 'SHA-256',
        last_modified_at: new Date().toISOString(),
      })
      .eq('id', fileId);

    if (updateError) throw new Error(`Failed to update file metadata: ${updateError.message}`);

    await supabaseClient.from('agent_activities').insert({
        case_id: caseId,
        agent_name: 'Summarizer Agent',
        agent_role: 'File Processor',
        activity_type: 'File Summarization Complete',
        content: `Successfully summarized and hashed file: ${filePath}. New name: ${parsedJson.suggested_name}`,
        status: 'completed',
    });

    return new Response(JSON.stringify({ message: "File summarized and hashed successfully." }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error: any) {
    console.error('Summarize File Error:', error.message, error.stack);
    const caseId = (await req.json().catch(() => ({})))?.caseId;
    if (caseId) {
        await createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '').from('agent_activities').insert({
            case_id: caseId,
            agent_name: 'Summarizer Agent',
            agent_role: 'Error Handler',
            activity_type: 'Summarization Failed',
            content: `Error processing file: ${error.message}`,
            status: 'error',
        });
    }
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});