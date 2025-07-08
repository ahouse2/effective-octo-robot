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

// Helper function to send Cypher queries via Neo4j HTTP Transactional Endpoint
async function neo4jHttpQuery(query: string, params: Record<string, any>, auth: {username: string, password: string}, httpUrl: string) {
  const authString = btoa(`${auth.username}:${auth.password}`); // Base64 encode credentials

  const response = await fetch(httpUrl, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${authString}`,
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
    const NEO4J_USER = Deno.env.get('NEO4J_USERNAME');
    const NEO4J_PASS = Deno.env.get('NEO4J_PASSWORD');

    if (!NEO4J_CONNECTION_URI || !NEO4J_USER || !NEO4J_PASS) {
      throw new Error('Neo4j connection URI or credentials are not set in Supabase secrets.');
    }

    let neo4jHost: string;
    try {
      const url = new URL(NEO4J_CONNECTION_URI);
      neo4jHost = url.hostname;
      if (neo4jHost === 'https' || neo4jHost === 'http') {
        throw new Error(`Invalid Neo4j connection URI hostname: "${neo4jHost}". Please ensure NEO4J_CONNECTION_URI is a valid Bolt URI (e.g., bolt://your-instance.aura.com:7687) or a full HTTP URL.`);
      }
    } catch (e) {
      throw new Error(`Invalid NEO4J_CONNECTION_URI format: ${e.message}. Please ensure it's a valid URL (e.g., bolt://your-instance.aura.com:7687).`);
    }

    const NEO4J_HTTP_TRANSACTION_ENDPOINT = `https://${neo4jHost}/db/neo4j/tx`; // Correct HTTP endpoint for transactional queries
    console.log(`Constructed Neo4j HTTP Endpoint: ${NEO4J_HTTP_TRANSACTION_ENDPOINT}`);

    let graphTextRepresentation = "";
    try {
      const resultData = await neo4jHttpQuery(
        'MATCH (c:Case {id: $caseId})-[r]-(n) RETURN c, r, n',
        { caseId },
        {username: NEO4J_USER, password: NEO4J_PASS},
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