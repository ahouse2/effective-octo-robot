import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { v1 } from 'npm:@google-cloud/discoveryengine@2.2.0';
import { GoogleGenerativeAI } from 'https://esm.sh/@google/generative-ai@0.15.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Function to convert a file blob to a Base64 string
async function fileToGenerativePart(blob: Blob, mimeType: string) {
  const arrayBuffer = await blob.arrayBuffer();
  return {
    inlineData: {
      data: btoa(String.fromCharCode(...new Uint8Array(arrayBuffer))),
      mimeType,
    },
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { filePath, fileId } = await req.json();
    if (!filePath || !fileId) throw new Error("filePath and fileId are required.");

    // --- Get GCP & Gemini Credentials from Supabase Secrets ---
    const gcpProjectId = Deno.env.get('GCP_PROJECT_ID');
    const gcpDataStoreId = Deno.env.get('GCP_VERTEX_AI_DATA_STORE_ID');
    const gcpServiceAccountKey = JSON.parse(Deno.env.get('GCP_SERVICE_ACCOUNT_KEY') ?? '{}');
    const geminiApiKey = Deno.env.get('GOOGLE_GEMINI_API_KEY');

    if (!gcpProjectId || !gcpDataStoreId || !gcpServiceAccountKey.client_email || !geminiApiKey) {
      throw new Error("GCP or Gemini credentials are not fully configured in Supabase secrets.");
    }

    // --- Initialize Clients ---
    const discoveryEngineClient = new v1.DocumentServiceClient({
      projectId: gcpProjectId,
      credentials: {
        client_email: gcpServiceAccountKey.client_email,
        private_key: gcpServiceAccountKey.private_key,
      },
    });
    const supabaseClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    const genAI = new GoogleGenerativeAI(geminiApiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });

    // --- Download file from Supabase Storage ---
    const { data: fileBlob, error: downloadError } = await supabaseClient.storage
      .from('evidence-files')
      .download(filePath);

    if (downloadError) throw new Error(`Failed to download file from Supabase Storage: ${downloadError.message}`);
    
    let documentContentForIndexing: string;
    const mimeType = fileBlob.type;

    // --- Multimodal Analysis for Images ---
    if (mimeType.startsWith('image/')) {
      const imagePart = await fileToGenerativePart(fileBlob, mimeType);
      const prompt = "Analyze this image in the context of a legal case. Describe any people, objects, text, and the overall scene. Provide a detailed summary that would be useful for a legal professional to understand the image's potential relevance without seeing it.";
      
      const result = await model.generateContent([prompt, imagePart]);
      const response = await result.response;
      documentContentForIndexing = response.text();

      // Update the file's description in Supabase with the generated text
      await supabaseClient
        .from('case_files_metadata')
        .update({ description: documentContentForIndexing })
        .eq('id', fileId);
    } else {
      // For non-image files, use the text content directly
      documentContentForIndexing = await fileBlob.text();
    }

    // --- Import Document to Vertex AI Search ---
    const parent = discoveryEngineClient.branchPath(gcpProjectId, 'global', gcpDataStoreId, 'default_branch');
    const [operation] = await discoveryEngineClient.importDocuments({
      parent: parent,
      inlineSource: {
        documents: [{
          parent: parent,
          id: fileId,
          jsonData: JSON.stringify({
            content: btoa(documentContentForIndexing), // Content must be base64 encoded
            mime_type: 'text/plain', // We now index the text description for all file types
          }),
        }],
      },
    });

    return new Response(JSON.stringify({ message: "File sent to Vertex AI for indexing.", operation: operation.name }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error: any) {
    console.error('Vectorize and Index Error:', error.message, error.stack);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});