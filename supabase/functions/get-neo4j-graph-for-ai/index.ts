import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import neo4j from 'https://esm.sh/neo4j-driver@5.20.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MAX_GRAPH_TEXT_LENGTH = 50000; // A safe character limit for the graph text

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { caseId } = await req.json();
    if (!caseId) throw new Error("Case ID is required.");

    const supabaseClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    
    const NEO4J_URI = Deno.env.get('NEO4J_URI');
    const NEO4J_USERNAME = Deno.env.get('NEO4J_USERNAME');
    const NEO4J_PASSWORD = Deno.env.get('NEO4J_PASSWORD');
    const NEO4J_DATABASE = Deno.env.get('NEO4J_DATABASE');

    if (!NEO4J_URI || !NEO4J_USERNAME || !NEO4J_PASSWORD || !NEO4J_DATABASE) {
      throw new Error('Neo4j credentials are not set in Supabase secrets.');
    }

    const driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USERNAME, NEO4J_PASSWORD));
    const session = driver.session({ database: NEO4J_DATABASE });

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
        const node1 = record.get('c');
        const rel = record.get('r');
        const node2 = record.get('n');
        
        const n1Label = node1.labels[0];
        const n1Name = node1.properties.name || node1.properties.title || 'Case';
        const n2Label = node2.labels[0];
        const n2Name = node2.properties.name || node2.properties.title || 'Node';
        const relType = rel.type;

        relationships.add(`(${n1Label}: ${n1Name})-[:${relType}]->(${n2Label}: ${n2Name})`);
      });
      graphTextRepresentation = Array.from(relationships).join('\n');
    } finally {
      await session.close();
      await driver.close();
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
        // In a real scenario, we might chunk this text as well, but for now, we'll truncate and warn.
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