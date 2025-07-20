/// <import map="./import_map.json" />
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.1';
import { Neo4j } from "../lib/deno_neo4j/mod.ts"; // Updated import path

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

  let driver: Neo4j | undefined;

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

    // Initialize Deno-native Neo4j Client
    driver = new Neo4j(NEO4J_CONNECTION_URI, { username: NEO4J_USERNAME, password: NEO4J_PASSWORD });
    await driver.connect();

    console.log(`Fetching graph data for AI analysis for case: ${caseId} using Deno Neo4j Client.`);

    let graphTextRepresentation = "";
    try {
      // Query to return relationships in a format suitable for text representation
      const { records } = await driver.query(
        `
        MATCH (c:Case {id: $caseId})-[r]-(n) 
        OPTIONAL MATCH (n)-[r2]-(m) 
        RETURN 
          labels(c) AS c_labels, properties(c).name AS c_name, properties(c).title AS c_title, properties(c).suggested_name AS c_suggested_name,
          labels(n) AS n_labels, properties(n).name AS n_name, properties(n).title AS n_title, properties(n).suggested_name AS n_suggested_name,
          type(r) AS r_type,
          CASE WHEN r2 IS NOT NULL THEN labels(m) ELSE NULL END AS m_labels, 
          CASE WHEN r2 IS NOT NULL THEN properties(m).name ELSE NULL END AS m_name, 
          CASE WHEN r2 IS NOT NULL THEN properties(m).title ELSE NULL END AS m_title, 
          CASE WHEN r2 IS NOT NULL THEN properties(m).suggested_name ELSE NULL END AS m_suggested_name,
          CASE WHEN r2 IS NOT NULL THEN type(r2) ELSE NULL END AS r2_type
        LIMIT 200
        `
        ,
        { caseId }
      );

      if (records.length === 0) {
        throw new Error("No graph data found for this case in Neo4j. Please export the data first.");
      }

      const relationships = new Set<string>();
      records.forEach(record => {
        const c_labels = record[0];
        const c_name = record[1] || record[2] || record[3] || c_labels[0];
        const n_labels = record[4];
        const n_name = record[5] || record[6] || record[7] || n_labels[0];
        const r_type = record[8];

        relationships.add(`(${c_labels[0]}: ${c_name})-[:${r_type}]->(${n_labels[0]}: ${n_name})`);

        const m_labels = record[9];
        const m_name = record[10] || record[11] || record[12] || (m_labels ? m_labels[0] : null);
        const r2_type = record[13];

        if (r2_type && m_labels && m_name) {
          relationships.add(`(${n_labels[0]}: ${n_name})-[:${r2_type}]->(${m_labels[0]}: ${m_name})`);
        }
      });
      graphTextRepresentation = Array.from(relationships).join('\n');
    } finally {
      // Driver is closed in the outer finally block
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
    if (driver) await driver.close();
  }
});