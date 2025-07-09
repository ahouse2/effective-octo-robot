import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.1';
import neo4j from "https://esm.sh/neo4j-driver@5.28.1"; // Import the Neo4j driver

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

const MAX_GRAPH_TEXT_LENGTH = 50000; // A safe character limit for the graph text

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  let driver;
  let session;

  try {
    const { caseId } = await req.json();
    if (!caseId) throw new Error("Case ID is required.");

    const supabaseClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    
    const NEO4J_CONNECTION_URI = Deno.env.get('NEO4J_CONNECTION_URI');
    const NEO4J_USERNAME = Deno.env.get('NEO4J_USERNAME');
    const NEO4J_PASSWORD = Deno.env.get('NEO4J_PASSWORD');

    if (!NEO4J_CONNECTION_URI || !NEO4J_USERNAME || !NEO4J_PASSWORD) {
      throw new Error('Neo4j connection URI or credentials (Username/Password) are not set in Supabase secrets.');
    }

    // Initialize Neo4j Driver
    driver = neo4j.driver(NEO4J_CONNECTION_URI, neo4j.auth.basic(NEO4J_USERNAME, NEO4J_PASSWORD));
    session = driver.session();

    console.log(`Fetching graph data for AI analysis for case: ${caseId} using Neo4j Driver.`);

    let graphTextRepresentation = "";
    try {
      const result = await session.run(
        'MATCH (c:Case {id: $caseId})-[r]-(n) RETURN c, r, n',
        { caseId }
      );

      if (result.records.length === 0) {
        throw new Error("No graph data found for this case in Neo4j. Please export the data first.");
      }

      const relationships = new Set<string>();
      result.records.forEach(record => {
        // Extract nodes and relationships from the record fields
        const nodesInRecord = record._fields.filter((f: any) => f.labels);
        const relationshipsInRecord = record._fields.filter((f: any) => f.type);

        relationshipsInRecord.forEach((rel: any) => {
          const startNode = nodesInRecord.find((n: any) => n.elementId === rel.startNodeElementId);
          const endNode = nodesInRecord.find((n: any) => n.elementId === rel.endNodeElementId);
          
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
      // Session and driver are closed in the outer finally block
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
  } finally {
    if (session) await session.close();
    if (driver) await driver.close();
  }
});