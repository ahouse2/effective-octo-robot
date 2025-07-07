import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import neo4j from 'https://esm.sh/neo4j-driver@4.0.0'; // Changed driver version to 4.0.0

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { caseId } = await req.json();
    if (!caseId) {
      return new Response(JSON.stringify({ error: 'Case ID is required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Move Neo4j credential checks here, after OPTIONS is handled
    const NEO4J_URI = Deno.env.get('NEO4J_URI');
    const NEO4J_USERNAME = Deno.env.get('NEO4J_USERNAME');
    const NEO4J_PASSWORD = Deno.env.get('NEO4J_PASSWORD');
    const NEO4J_DATABASE = Deno.env.get('NEO4J_DATABASE');

    if (!NEO4J_URI || !NEO4J_USERNAME || !NEO4J_PASSWORD || !NEO4J_DATABASE) {
      return new Response(JSON.stringify({ error: 'Neo4j credentials are not set in Supabase secrets.' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const supabaseClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    // Explicitly enable encryption and use 'TRUST_SYSTEM_CA_SIGNED_CERTIFICATES' for Deno compatibility
    const driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USERNAME, NEO4J_PASSWORD), { encrypted: 'ENCRYPTION_ON', trust: 'TRUST_SYSTEM_CA_SIGNED_CERTIFICATES', disableLosslessRecord: true });
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

      // This part is for the AI analysis, not for the client-side graph display
      // It should probably be in get-neo4j-graph-for-ai, not here.
      // For now, I'll keep it as is, but it's a potential refactor.
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

      return new Response(JSON.stringify(graphData), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });

    } finally {
      await session.close();
      await driver.close();
    }

  } catch (error: any) {
    console.error('Neo4j query error:', error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});