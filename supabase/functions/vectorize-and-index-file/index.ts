import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { v1 } from 'https://esm.sh/@google-cloud/discoveryengine@4.13.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { filePath, fileId } = await req.json();
    if (!filePath || !fileId) throw new Error("filePath and fileId are required.");

    // --- Get GCP Credentials from Supabase Secrets ---
    const gcpProjectId = Deno.env.get('GCP_PROJECT_ID');
    const gcpDataStoreId = Deno.env.get('GCP_VERTEX_AI_DATA_STORE_ID');
    const gcpServiceAccountKey = JSON.parse(Deno.env.get('GCP_SERVICE_ACCOUNT_KEY') ?? '{}');

    if (!gcpProjectId || !gcpDataStoreId || !gcpServiceAccountKey.client_email) {
      throw new Error("GCP credentials are not fully configured in Supabase secrets.");
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

    // --- Download file from Supabase Storage ---
    const { data: fileBlob, error: downloadError } = await supabaseClient.storage
      .from('evidence-files')
      .download(filePath);

    if (downloadError) throw new Error(`Failed to download file from Supabase Storage: ${downloadError.message}`);
    const fileContentBase64 = btoa(await fileBlob.text());

    // --- Import Document to Vertex AI Search ---
    const parent = discoveryEngineClient.branchPath(gcpProjectId, 'global', gcpDataStoreId, 'default_branch');
    const [operation] = await discoveryEngineClient.importDocuments({
      parent: parent,
      inlineSource: {
        documents: [{
          parent: parent,
          id: fileId,
          jsonData: JSON.stringify({
            content: fileContentBase64,
            mime_type: fileBlob.type,
          }),
        }],
      },
    });

    return new Response(JSON.stringify({ message: "File sent to Vertex AI for indexing.", operation: operation.name }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error: any) {
    console.error('Vectorize and Index Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});