import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

const MAX_GRAPH_TEXT_LENGTH = 50000; // A safe character limit for the graph text

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
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { caseId } = await req.json();
    if (!caseId) throw new Error("Case ID is required.");

    const supabaseClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    
    const NEO4J_CONNECTION_URI = Deno.env.get('NEO4J_CONNECTION_URI');
    const NEO4J_CLIENT_ID = Deno.env.get('NEO4J_USERNAME'); // This will now be the API Client ID
    const NEO4J_CLIENT_SECRET = Deno.env.get('NEO4J_PASSWORD'); // This will now be the Client Secret

    if (!NEO4J_CONNECTION_URI || !NEO4J_CLIENT_ID || !NEO4J_CLIENT_SECRET) {
      throw new Error('Neo4j connection URI or credentials (Client ID/Secret) are not set in Supabase secrets.');
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

    let graphTextRepresentation = "";
    try {
      const resultData = await neo4jHttpQuery(
        'MATCH (c:Case {id: $caseId})-[r]-(n) RETURN c, r, n',
        { caseId },
        NEO4J_CLIENT_ID, NEO4J_CLIENT_SECRET, // Pass client ID/secret for token acquisition
        NEO4J_HTTP_TRANSACTION_ENDPOINT
      );

      if (resultData.length === 0) {
        throw new Error("No graph data found for this case in Neo4j. Please export the data first.");
      }

      const relationships = new Set<string>();
      resultData.forEach(record => {
        const nodesInRecord = record.graph.nodes;
        const relationshipsInRecord = record.graph.relationships;

        relationshipsInRecord.forEach(rel => {
          const startNode = nodesInRecord.find((n: any) => n.id === rel.startNode);
          const endNode = nodesInRecord.find((n: any) => n.id === rel.endNode);
          
          if (startNode && endNode) {
            const n1Label = startNode.labels[0];
            const n1Name = startNode.properties.name || startNode.properties.title || startNode.properties.suggested_name || n1Label;
            const n2Label = endNode.labels[0];
            const n2Name = endNode.properties.name || endNode.properties.title || endNode.properties.suggested_name || n2Label;
            const relType = rel.type;

            relationships.add(`(${n1Label}: ${n1Name})-[:${relType}]->(${n2Label}: ${n2Name})`);
          }
        });
      });
      graphTextRepresentation = Array.from(relationships).join('\n');
    } finally {
      // No explicit session/driver close needed for HTTP fetch
    }

    if (graphTextRepresentation.length > MAX_GRAPH_TEXT_LENGTH) {
        await supabaseClient.from('agent_activities').insert({
            case_id: caseId,
            agent_name: 'Graph Agent',
            agent_role: 'System',
            activity_type: 'Graph Analysis Warning',
            content: `The knowledge graph is too large to analyze in a single pass. Analysis will be performed on a summarized version of the graph. For full detail, explore the graph visually.`,
            status: 'completed',
        });
        graphTextRepresentation = graphTextRepresentation.substring(0, MAX_GRAPH_TEXT_LENGTH);
    }

    const promptForAI = `
      The following is a text representation of a knowledge graph for a legal case. Each line represents a relationship between two entities.
      Analyze these relationships to identify key insights, hidden patterns, and important entities.
      Summarize your findings in a clear, concise manner. Focus on connections that might be important for a legal strategy.

      Graph Data:
      ---
      ${graphTextRepresentation}
      ---
    `;

    await supabaseClient.from('agent_activities').insert({
      case_id: caseId,
      agent_name: 'User',
      agent_role: 'Client',
      activity_type: 'User Prompt',
      content: "Analyze the case knowledge graph.",
      status: 'completed',
    });

    const { error: orchestratorError } = await supabaseClient.functions.invoke('ai-orchestrator', {
      body: {
        caseId,
        command: 'user_prompt',
        payload: { promptContent: promptForAI },
      },
    });

    if (orchestratorError) {
      throw new Error(`Failed to invoke AI Orchestrator: ${orchestratorError.message}`);
    }

    return new Response(JSON.stringify({ message: "Graph analysis prompt sent to AI." }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error: any) {
    console.error('Graph-to-AI Error:', error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});