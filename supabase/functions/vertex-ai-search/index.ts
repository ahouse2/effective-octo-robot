import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { v1 } from 'npm:@google-cloud/discoveryengine@2.2.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// --- Initialize client outside the handler for potential reuse on warm starts ---
let discoveryEngineClient: v1.SearchServiceClient | null = null;
let initError: string | null = null;

try {
    const gcpProjectId = Deno.env.get('GCP_PROJECT_ID');
    const gcpServiceAccountKeyRaw = Deno.env.get('GCP_SERVICE_ACCOUNT_KEY');

    if (!gcpProjectId || !gcpServiceAccountKeyRaw) {
        throw new Error("GCP_PROJECT_ID or GCP_SERVICE_ACCOUNT_KEY secrets are not set.");
    }
    const gcpServiceAccountKey = JSON.parse(gcpServiceAccountKeyRaw);
    if (!gcpServiceAccountKey.client_email || !gcpServiceAccountKey.private_key) {
        throw new Error("GCP_SERVICE_ACCOUNT_KEY is not a valid JSON key file.");
    }
    discoveryEngineClient = new v1.SearchServiceClient({
      projectId: gcpProjectId,
      credentials: {
        client_email: gcpServiceAccountKey.client_email,
        private_key: gcpServiceAccountKey.private_key,
      },
    });
} catch (e) {
    console.error("Failed to initialize Discovery Engine client:", e.message);
    initError = e.message;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Check if client failed to initialize
  if (initError || !discoveryEngineClient) {
      return new Response(JSON.stringify({ error: `Client initialization failed: ${initError}` }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      });
  }

  try {
    const { query } = await req.json();
    if (!query) throw new Error("Query is required.");

    const gcpDataStoreId = Deno.env.get('GCP_VERTEX_AI_DATA_STORE_ID');
    if (!gcpDataStoreId) {
      throw new Error("GCP_VERTEX_AI_DATA_STORE_ID secret is not set.");
    }
    
    const gcpProjectId = Deno.env.get('GCP_PROJECT_ID'); // Re-get for the servingConfig path
    const servingConfig = `projects/${gcpProjectId}/locations/global/collections/default_collection/dataStores/${gcpDataStoreId}/servingConfigs/default_serving_config`;
    
    const [searchResponse] = await discoveryEngineClient.search({
      servingConfig,
      query,
      pageSize: 10,
      contentSearchSpec: { snippetSpec: { returnSnippet: true } } // Removed summarySpec to improve performance
    }, { timeout: 120000 });

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