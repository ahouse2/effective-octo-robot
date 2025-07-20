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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    console.log('Received OPTIONS request for get-neo4j-graph');
    return new Response(null, { headers: corsHeaders });
  }

  let driver: Neo4j | undefined;

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

    // Initialize Deno-native Neo4j Client
    driver = new Neo4j(NEO4J_CONNECTION_URI, { username: NEO4J_USERNAME, password: NEO4J_PASSWORD });
    await driver.connect();

    console.log(`Fetching graph data for case: ${caseId} using Deno Neo4j Client.`);
    
    // Query to return nodes and relationships in a format easier to parse
    const { records } = await driver.query(
      `
      MATCH (c:Case {id: $caseId})-[r]-(n) 
      OPTIONAL MATCH (n)-[r2]-(m) 
      RETURN 
        apoc.map.merge(properties(c), {id: id(c), labels: labels(c)}) AS c_node, 
        apoc.map.merge(properties(n), {id: id(n), labels: labels(n)}) AS n_node, 
        type(r) AS r_type, id(startNode(r)) AS r_start, id(endNode(r)) AS r_end,
        CASE WHEN r2 IS NOT NULL THEN apoc.map.merge(properties(m), {id: id(m), labels: labels(m)}) ELSE NULL END AS m_node,
        CASE WHEN r2 IS NOT NULL THEN type(r2) ELSE NULL END AS r2_type, 
        CASE WHEN r2 IS NOT NULL THEN id(startNode(r2)) ELSE NULL END AS r2_start, 
        CASE WHEN r2 IS NOT NULL THEN id(endNode(r2)) ELSE NULL END AS r2_end
      LIMIT 200
      `,
      { caseId }
    );

    if (records.length === 0) {
      throw new Error("No graph data found for this case in Neo4j. Please export the data first.");
    }

    const nodesMap = new Map();
    const linksMap = new Map();

    records.forEach(record => {
      // Each record is an array of values returned by the RETURN clause
      const c_node = record[0];
      const n_node = record[1];
      const r_type = record[2];
      const r_start = record[3];
      const r_end = record[4];
      const m_node = record[5];
      const r2_type = record[6];
      const r2_start = record[7];
      const r2_end = record[8];

      // Add c_node
      if (c_node && !nodesMap.has(c_node.id)) {
        nodesMap.set(c_node.id, {
          id: c_node.id,
          name: c_node.name || c_node.title || c_node.suggested_name || c_node.labels[0],
          label: c_node.labels[0],
        });
      }

      // Add n_node
      if (n_node && !nodesMap.has(n_node.id)) {
        nodesMap.set(n_node.id, {
          id: n_node.id,
          name: n_node.name || n_node.title || n_node.suggested_name || n_node.labels[0],
          label: n_node.labels[0],
        });
      }

      // Add m_node (if exists)
      if (m_node && !nodesMap.has(m_node.id)) {
        nodesMap.set(m_node.id, {
          id: m_node.id,
          name: m_node.name || m_node.title || m_node.suggested_name || m_node.labels[0],
          label: m_node.labels[0],
        });
      }

      // Add first relationship (c)-[r]-(n)
      if (r_type && r_start && r_end) {
        const linkKey = `${r_start}-${r_end}-${r_type}`;
        if (!linksMap.has(linkKey)) {
          linksMap.set(linkKey, {
            source: r_start,
            target: r_end,
            label: r_type,
          });
        }
      }

      // Add second relationship (n)-[r2]-(m) if it exists
      if (r2_type && r2_start && r2_end) {
        const linkKey = `${r2_start}-${r2_end}-${r2_type}`;
        if (!linksMap.has(linkKey)) {
          linksMap.set(linkKey, {
            source: r2_start,
            target: r2_end,
            label: r2_type,
          });
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
    if (driver) await driver.close();
  }
});