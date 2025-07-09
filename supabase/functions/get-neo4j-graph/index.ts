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

    const NEO4J_CONNECTION_URI = Deno.env.get('NEO4J_CONNECTION_URI');
    const NEO4J_USERNAME = Deno.env.get('NEO4J_USERNAME');
    const NEO4J_PASSWORD = Deno.env.get('NEO4J_PASSWORD');

    if (!NEO4J_CONNECTION_URI || !NEO4J_USERNAME || !NEO4J_PASSWORD) {
      return new Response(JSON.stringify({ error: 'Neo4j connection URI or credentials (Username/Password) are not set in Supabase secrets.' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Initialize Neo4j Driver
    driver = neo4j.driver(NEO4J_CONNECTION_URI, neo4j.auth.basic(NEO4J_USERNAME, NEO4J_PASSWORD));
    session = driver.session();

    console.log(`Fetching graph data for case: ${caseId} using Neo4j Driver.`);
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
      // Extract nodes and relationships from the record fields
      record._fields.forEach((field: any) => {
        if (field.labels) { // It's a node
          if (!nodesMap.has(field.elementId)) {
            nodesMap.set(field.elementId, {
              id: field.elementId,
              name: field.properties.name || field.properties.title || field.properties.suggested_name || field.labels[0],
              label: field.labels[0],
            });
          }
        } else if (field.type) { // It's a relationship
          const sourceId = field.startNodeElementId;
          const targetId = field.endNodeElementId;
          const linkKey = `${sourceId}-${targetId}-${field.type}`;
          if (!linksMap.has(linkKey)) {
            linksMap.set(linkKey, {
              source: sourceId,
              target: targetId,
              label: field.type,
            });
          }
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
  } finally {
    if (session) await session.close();
    if (driver) await driver.close();
  }
});