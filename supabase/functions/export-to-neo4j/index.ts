import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store'
};

// Function to send Cypher queries via Neo4j HTTP Transactional Endpoint
async function neo4jHttpQuery(query: string, params: Record<string, any>, auth: {username: string, password: string}, httpUrl: string) {
  const authString = btoa(`${auth.username}:${auth.password}`); // Base64 encode credentials

  const requestBody = JSON.stringify({
    statements: [{
      statement: query,
      parameters: params
    }]
  });

  console.log(`[Neo4j HTTP Query] Sending request to: ${httpUrl}`);
  console.log(`[Neo4j HTTP Query] Request Body: ${requestBody}`);

  const response = await fetch(httpUrl, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${authString}`,
      "Content-Type": "application/json",
    },
    body: requestBody
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[Neo4j HTTP Query] Request failed: Status ${response.status}, Body: ${errorText}`);
    throw new Error(`Neo4j HTTP error: Status ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  if (data.errors && data.errors.length > 0) {
    console.error(`[Neo4j HTTP Query] Query returned errors: ${JSON.stringify(data.errors)}`);
    throw new Error(`Neo4j query error: ${data.errors.map((e: any) => e.message).join(', ')}`);
  }
  console.log(`[Neo4j HTTP Query] Request successful. Response data: ${JSON.stringify(data)}`);
  return data;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { caseId } = await req.json();
    if (!caseId) throw new Error("Case ID is required");

    const NEO4J_CONNECTION_URI = Deno.env.get('NEO4J_CONNECTION_URI');
    const NEO4J_USER = Deno.env.get('NEO4J_USERNAME');
    const NEO4J_PASS = Deno.env.get('NEO4J_PASSWORD');
    
    if (!NEO4J_CONNECTION_URI || !NEO4J_USER || !NEO4J_PASS) {
      throw new Error('Neo4j connection URI or credentials are not configured in Supabase secrets.');
    }

    let NEO4J_HTTP_TRANSACTION_ENDPOINT: string;
    try {
      const url = new URL(NEO4J_CONNECTION_URI);
      if (url.protocol === 'https:') {
        // If it's already an HTTPS URL, use it as the base for the transactional endpoint
        NEO4J_HTTP_TRANSACTION_ENDPOINT = `${url.origin}/db/neo4j/tx`;
      } else if (url.protocol === 'bolt:' || url.protocol === 'neo4j:' || url.protocol === 'neo4j+s:') {
        // If it's a Bolt/Neo4j URI, extract hostname and construct HTTPS endpoint
        NEO4J_HTTP_TRANSACTION_ENDPOINT = `https://${url.hostname}/db/neo4j/tx`;
      } else {
        throw new Error(`Unsupported protocol in NEO4J_CONNECTION_URI: ${url.protocol}. Expected 'https:', 'bolt:', 'neo4j:', or 'neo4j+s:'.`);
      }
    } catch (e) {
      throw new Error(`Invalid NEO4J_CONNECTION_URI format: ${e.message}. Please ensure it's a valid URL (e.g., https://your-instance.aura.com or bolt://your-instance.aura.com:7687 or neo4j+s://your-instance.aura.com).`);
    }

    console.log(`Constructed Neo4j HTTP Endpoint: ${NEO4J_HTTP_TRANSACTION_ENDPOINT}`);

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // 1. Get case data
    const { data: caseData, error: caseError } = await supabaseClient
      .from('cases')
      .select('*')
      .eq('id', caseId)
      .single();

    if (caseError) throw caseError;

    // 2. Create Case node
    await neo4jHttpQuery(
      `MERGE (c:Case {id: $id}) 
       SET c.name = $name, 
           c.type = $type, 
           c.status = $status`,
      {
        id: caseData.id,
        name: caseData.name,
        type: caseData.type,
        status: caseData.status
      },
      {username: NEO4J_USER, password: NEO4J_PASS},
      NEO4J_HTTP_TRANSACTION_ENDPOINT
    );

    // 3. Process files
    const { data: files } = await supabaseClient
      .from('case_files_metadata')
      .select('*')
      .eq('case_id', caseId);

    for (const file of files || []) {
      await neo4jHttpQuery(
        `MATCH (c:Case {id: $caseId})
         MERGE (f:File {id: $fileId})
         SET f.name = $fileName
         MERGE (c)-[:HAS_EVIDENCE]->(f)`,
        {
          caseId: caseData.id,
          fileId: file.id,
          fileName: file.suggested_name || file.file_name
        },
        {username: NEO4J_USER, password: NEO4J_PASS},
        NEO4J_HTTP_TRANSACTION_ENDPOINT
      );
    }

    return new Response(JSON.stringify({ message: 'Export successful' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    });

  } catch (error: any) {
    console.error('Neo4j HTTP Export Error:', error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});