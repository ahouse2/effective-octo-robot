import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import neo4j from 'https://esm.sh/neo4j-driver@5.20.0'; // Using official Neo4j driver

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    console.log('Received OPTIONS request for get-neo4j-graph');
    return new Response(null, { headers: corsHeaders });
  }

  let driver;
  let session;
  try {
    const { caseId } = await req.json();
    if (!caseId) {
      return new Response(JSON.stringify({ error: 'Case ID is required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const NEO4J_URI = Deno.env.get('NEO4J_URI');
    const NEO4J_USERNAME = Deno.env.get('NEO4J_USERNAME');
    const NEO4J_PASSWORD = Deno.env.get('NEO4J_PASSWORD');
    const NEO4J_DATABASE = Deno.env.get('NEO4J_DATABASE');

    if (!NEO4J_URI || !NEO4J_USERNAME || !NEO4J_PASSWORD || !NEO4J_DATABASE) {
      throw new Error('Neo4j credentials are not set in Supabase secrets.');
    }

    const supabaseClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    
    console.log('Attempting to connect to Neo4j...');
    driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USERNAME, NEO4J_PASSWORD));
    session = driver.session({ database: NEO4J_DATABASE });
    console.log('Successfully connected to Neo4j.');

    console.log(`Fetching graph data for case: ${caseId}`);
    const result = await session.run(
      'MATCH (c:Case {id: $caseId})-[r]-(n) RETURN c, r, n',
      { caseId }
    );

    if (result.records.length === 0) {
      throw new Error("No graph data found for this case in Neo4j. Please export the data first.");
    }

    const nodesMap = new Map();
    const linksMap = new Map();

    result.records.forEach(record => {
      const node1 = record.get('c');
      const rel = record.get('r');
      const node2 = record.get('n');

      [node1, node2].forEach(node => {
        if (node && !nodesMap.has(node.identity.toString())) {
          nodesMap.set(node.identity.toString(), {
            id: node.properties.id,
            name: node.properties.name || node.properties.title || node.properties.suggestedName || node.labels[0],
            label: node.labels[0],
          });
        }
      });

      if (rel) {
        const sourceId = nodesMap.get(rel.start.toString())?.id;
        const targetId = nodesMap.get(rel.end.toString())?.id;
        if (sourceId && targetId) {
          const linkKey = `${sourceId}-${targetId}-${rel.type}`;
          if (!linksMap.has(linkKey)) {
            linksMap.set(linkKey, {
              source: sourceId,
              target: targetId,
              label: rel.type,
            });
          }
        }
      }
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
  } finally {
    if (session) {
      await session.close();
      console.log('Neo4j session closed.');
    }
    if (driver) {
      await driver.close();
      console.log('Neo4j driver closed.');
    }
  }
});