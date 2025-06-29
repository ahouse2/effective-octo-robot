import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { v1 } from 'npm:@google-cloud/discoveryengine@2.2.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { query } = await req.json();
    if (!query) throw new Error("Query is required.");

    const gcpProjectId = Deno.env.get('GCP_PROJECT_ID');
    const gcpDataStoreId = Deno.env.get('GCP_VERTEX_AI_DATA_STORE_ID');
    const gcpServiceAccountKey = JSON.parse(Deno.env.get('GCP_SERVICE_ACCOUNT_KEY') ?? '{}');

    if (!gcpProjectId || !gcpDataStoreId || !gcpServiceAccountKey.client_email) {
      throw new Error("Vertex AI Search credentials are not fully configured in Supabase secrets.");
    }

    const discoveryEngineClient = new v1.SearchServiceClient({
      projectId: gcpProjectId,
      credentials: {
        client_email: gcpServiceAccountKey.client_email,
        private_key: gcpServiceAccountKey.private_key,
      },
    });

    const servingConfig = `projects/${gcpProjectId}/locations/global/collections/default_collection/dataStores/${gcpDataStoreId}/servingConfigs/default_serving_config`;
    
    const [searchResponse] = await discoveryEngineClient.search({
      servingConfig,
      query,
      pageSize: 10,
      contentSearchSpec: { snippetSpec: { returnSnippet: true }, summarySpec: { includeCitations: true } }
    }, { timeout: 120000 }); // Keep generous timeout

    return new Response(JSON.stringify(searchResponse), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error: any) {
    console.error('Vertex AI Search Function Error:', error.message, error.stack);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});