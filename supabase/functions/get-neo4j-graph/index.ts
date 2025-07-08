import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

// Global variables to store the access token and its expiration
let neo4jAccessToken: string | null = null;
let neo4jTokenExpiry: number = 0; // Unix timestamp in milliseconds

// Function to obtain or refresh the Neo4j AuraDB OAuth token
async function getNeo4jAccessToken(clientId: string, clientSecret: string): Promise<string> {
  const now = Date.now();
  // Check if the current token is still valid (e.g., expires in more than 5 minutes)
  if (neo4jAccessToken && neo4jTokenExpiry > now + (5 * 60 * 1000)) {
    console.log("[Neo4j Auth] Reusing existing access token.");
    return neo4jAccessToken;
  }

  console.log("[Neo4j Auth] Obtaining new access token...");
  const authString = btoa(`${clientId}:${clientSecret}`); // Base64 encode client ID and secret

  const response = await fetch('https://api.neo4j.io/oauth/token', {
    method: "POST",
    headers: {
      "Authorization": `Basic ${authString}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      'grant_type': 'client_credentials'
    }).toString()
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[Neo4j Auth] Failed to get access token: Status ${response.status}, Body: ${errorText}`);
    throw new Error(`Neo4j OAuth token error: Status ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  neo4jAccessToken = data.access_token;
  neo4jTokenExpiry = now + (data.expires_in * 1000); // expires_in is in seconds

  console.log("[Neo4j Auth] New access token obtained. Expires in:", data.expires_in, "seconds.");
  return neo4jAccessToken;
}

// Helper function to send Cypher queries via Neo4j HTTP Transactional Endpoint
async function neo4jHttpQuery(query: string, params: Record<string, any>, clientId: string, clientSecret: string, httpUrl: string) {
  const accessToken = await getNeo4jAccessToken(clientId, clientSecret);

  const response = await fetch(httpUrl, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`, // Use Bearer token here
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      statements: [{
        statement: query,
        parameters: params,
        resultDataContents: ["row", "graph"] // Request both row and graph data
      }]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Neo4j HTTP error: ${response.status} ${response.statusText} - ${errorText}`);
  }

  const data = await response.json();
  if (data.errors && data.errors.length > 0) {
    throw new Error(`Neo4j query error: ${data.errors.map((e: any) => e.message).join(', ')}`);
  }
  // Return the data part of the first result, which contains rows and graph objects
  return data.results[0]?.data || [];
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    console.log('Received OPTIONS request for get-neo4j-graph');
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { caseId } = await req.json();
    if (!caseId) {
      return new Response(JSON.stringify({ error: 'Case ID is required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const NEO4J_CONNECTION_URI = Deno.env.get('NEO4J_CONNECTION_URI');
    const NEO4J_CLIENT_ID = Deno.env.get('NEO4J_USERNAME'); // This will now be the API Client ID
    const NEO4J_CLIENT_SECRET = Deno.env.get('NEO4J_PASSWORD'); // This will now be the Client Secret

    if (!NEO4J_CONNECTION_URI || !NEO4J_CLIENT_ID || !NEO4J_CLIENT_SECRET) {
      return new Response(JSON.stringify({ error: 'Neo4j connection URI or credentials (Client ID/Secret) are not set in Supabase secrets.' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
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

    const supabaseClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    
    console.log(`Fetching graph data for case: ${caseId} using HTTP API.`);
    const resultData = await neo4jHttpQuery(
      'MATCH (c:Case {id: $caseId})-[r]-(n) RETURN c, r, n',
      { caseId },
      NEO4J_CLIENT_ID, NEO4J_CLIENT_SECRET, // Pass client ID/secret for token acquisition
      NEO4J_HTTP_TRANSACTION_ENDPOINT
    );

    if (resultData.length === 0) {
      throw new Error("No graph data found for this case in Neo4j. Please export the data first.");
    }

    const nodesMap = new Map();
    const linksMap = new Map();

    resultData.forEach(record => {
      // record.graph contains the actual node and relationship objects
      const nodesInRecord = record.graph.nodes;
      const relationshipsInRecord = record.graph.relationships;

      nodesInRecord.forEach(node => {
        if (!nodesMap.has(node.id)) {
          nodesMap.set(node.id, {
            id: node.id,
            name: node.properties.name || node.properties.title || node.properties.suggested_name || node.labels[0],
            label: node.labels[0],
          });
        }
      });

      relationshipsInRecord.forEach(rel => {
        const sourceId = rel.startNode;
        const targetId = rel.endNode;
        const linkKey = `${sourceId}-${targetId}-${rel.type}`;
        if (!linksMap.has(linkKey)) {
          linksMap.set(linkKey, {
            source: sourceId,
            target: targetId,
            label: rel.type,
          });
        }
      });
    });
      
    const graphData = {
      nodes: Array.from(nodesMap.values()),
      links: Array.from(linksMap.values()),
    };

    console.log(`Successfully fetched graph data for case: ${caseId}. Nodes: ${graphData.nodes.length}, Links: ${graphData.links.length}`);

    return new Response(JSON.stringify(graphData), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error: any) {
    console.error('Neo4j query error:', error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});