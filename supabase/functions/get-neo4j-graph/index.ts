import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import neo4j from 'https://esm.sh/neo4j-driver@5.22.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const { caseId } = await req.json();
  if (!caseId) {
    return new Response(JSON.stringify({ error: 'Case ID is required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const NEO4J_URI = Deno.env.get('NEO4J_URI');
  const NEO4J_USERNAME = Deno.env.get('NEO4J_USERNAME');
  const NEO4J_PASSWORD = Deno.env.get('NEO4J_PASSWORD');

  if (!NEO4J_URI || !NEO4J_USERNAME || !NEO4J_PASSWORD) {
    return new Response(JSON.stringify({ error: 'Neo4j credentials are not set in Supabase secrets.' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USERNAME, NEO4J_PASSWORD));
  const session = driver.session({ database: 'neo4j' });

  try {
    const result = await session.run(
      'MATCH (c:Case {id: $caseId})-[r]-(n) RETURN c, r, n',
      { caseId }
    );

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

    return new Response(JSON.stringify(graphData), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error('Neo4j query error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } finally {
    await session.close();
    await driver.close();
  }
});