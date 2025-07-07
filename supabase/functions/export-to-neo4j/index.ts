import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { Neo4j } from "https://deno.land/x/deno_neo4j@1.0.0/mod.ts"; // Using deno-neo4j

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

    const NEO4J_URI = Deno.env.get('NEO4J_URI');
    const NEO4J_USERNAME = Deno.env.get('NEO4J_USERNAME');
    const NEO4J_PASSWORD = Deno.env.get('NEO4J_PASSWORD');
    const NEO4J_DATABASE = Deno.env.get('NEO4J_DATABASE');

    if (!NEO4J_URI || !NEO4J_USERNAME || !NEO4J_PASSWORD || !NEO4J_DATABASE) {
      return new Response(JSON.stringify({ error: 'Neo4j credentials are not set in Supabase secrets.' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const supabaseClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    
    // Initialize deno-neo4j client
    const neo4j = new Neo4j(NEO4J_URI, {
      username: NEO4J_USERNAME,
      password: NEO4J_PASSWORD,
      database: NEO4J_DATABASE,
      encrypted: true, // AuraDB is always encrypted
    });

    await neo4j.connect(); // Connect to the database

    try {
        console.log(`Starting Neo4j export for case: ${caseId}`);

        const { data: caseData, error: caseError } = await supabaseClient.from('cases').select('*').eq('id', caseId).single();
        if (caseError) throw new Error(`Failed to fetch case: ${caseError.message}`);

        const { data: filesData, error: filesError } = await supabaseClient.from('case_files_metadata').select('*').eq('case_id', caseId);
        if (filesError) throw new Error(`Failed to fetch files: ${filesError.message}`);

        const { data: insightsData, error: insightsError } = await supabaseClient.from('case_insights').select('*').eq('case_id', caseId);
        if (insightsError) throw new Error(`Failed to fetch insights: ${insightsError.message}`);

        // Clear existing data for the case
        await neo4j.query(
          `MATCH (c:Case {id: $caseId}) OPTIONAL MATCH (c)-[r]-() DELETE r`,
          { caseId }
        );
        await neo4j.query(
          `MATCH (n) WHERE n.caseId = $caseId AND NOT n:Case DETACH DELETE n`,
          { caseId }
        );

        // Create Case node
        await neo4j.query(
          'MERGE (c:Case {id: $id}) SET c.name = $name, c.type = $type, c.status = $status, c.caseId = $id',
          { id: caseData.id, name: caseData.name, type: caseData.type, status: caseData.status }
        );

        if (filesData && filesData.length > 0) {
          // Create File nodes and HAS_EVIDENCE relationships
          for (const file of filesData) {
            await neo4j.query(
              `MERGE (f:File {id: $id})
               SET f += {name: $name, suggestedName: $suggestedName, caseId: $caseId}
               WITH f
               MATCH (c:Case {id: $caseId})
               MERGE (c)-[:HAS_EVIDENCE]->(f)`,
              { id: file.id, name: file.file_name, suggestedName: file.suggested_name, caseId }
            );
            // Create Category nodes and IS_CATEGORIZED_AS relationships
            if (file.file_category) {
              await neo4j.query(
                `MERGE (cat:Category {name: $categoryName, caseId: $caseId})
                 WITH cat
                 MATCH (f:File {id: $fileId})
                 MERGE (f)-[:IS_CATEGORIZED_AS]->(cat)`,
                { categoryName: file.file_category, fileId: file.id, caseId }
              );
            }
            // Create Tag nodes and HAS_TAG relationships
            if (file.tags && file.tags.length > 0) {
              for (const tagName of file.tags) {
                await neo4j.query(
                  `MERGE (t:Tag {name: $tagName, caseId: $caseId})
                   WITH t
                   MATCH (f:File {id: $fileId})
                   MERGE (f)-[:HAS_TAG]->(t)`,
                  { tagName, fileId: file.id, caseId }
                );
              }
            }
          }
        }

        if (insightsData && insightsData.length > 0) {
          // Create Insight nodes and HAS_INSIGHT relationships
          for (const insight of insightsData) {
            await neo4j.query(
              `MERGE (i:Insight {id: $id})
               SET i += {title: $title, description: $description, type: $type, caseId: $caseId}
               WITH i
               MATCH (c:Case {id: $caseId})
               MERGE (c)-[:HAS_INSIGHT]->(i)`,
              { id: insight.id, title: insight.title, description: insight.description, type: insight.insight_type, caseId }
            );
          }
        }

        console.log(`Successfully completed Neo4j export for case: ${caseId}`);
        return new Response(JSON.stringify({ message: 'Case data successfully exported to Neo4j.' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        });
    } finally {
        await neo4j.close(); // Close the connection
    }
  } catch (error) {
    console.error('Neo4j export error:', error.message, error.stack);
    return new Response(JSON.stringify({ error: 'Failed to export to Neo4j.', details: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});