import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import neo4j from 'https://esm.sh/neo4j-driver@5.22.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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
    const driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USERNAME, NEO4J_PASSWORD));
    const session = driver.session({ database: NEO4J_DATABASE });

    console.log(`Starting Neo4j export for case: ${caseId}`);

    const { data: caseData, error: caseError } = await supabaseClient.from('cases').select('*').eq('id', caseId).single();
    if (caseError) throw new Error(`Failed to fetch case: ${caseError.message}`);

    const { data: filesData, error: filesError } = await supabaseClient.from('case_files_metadata').select('*').eq('case_id', caseId);
    if (filesError) throw new Error(`Failed to fetch files: ${filesError.message}`);

    const { data: insightsData, error: insightsError } = await supabaseClient.from('case_insights').select('*').eq('case_id', caseId);
    if (insightsError) throw new Error(`Failed to fetch insights: ${insightsError.message}`);

    await session.executeWrite(async (tx) => {
      await tx.run(
        `
        MATCH (c:Case {id: $caseId})
        OPTIONAL MATCH (c)-[r]-()
        DELETE r
        `,
        { caseId }
      );
      await tx.run(
        `
        MATCH (c:Case {id: $caseId})
        OPTIONAL MATCH (c)-[:HAS_EVIDENCE]->(f:File)
        OPTIONAL MATCH (c)-[:HAS_INSIGHT]->(i:Insight)
        DETACH DELETE f, i
        `,
        { caseId }
      );

      await tx.run(
        'MERGE (c:Case {id: $id}) SET c.name = $name, c.type = $type, c.status = $status',
        { id: caseData.id, name: caseData.name, type: caseData.type, status: caseData.status }
      );

      if (filesData && filesData.length > 0) {
        await tx.run(
          `
          UNWIND $files AS file
          MERGE (f:File {id: file.id})
          SET f.name = file.file_name, f.suggestedName = file.suggested_name
          WITH f, file
          MATCH (c:Case {id: $caseId})
          MERGE (c)-[:HAS_EVIDENCE]->(f)
          `,
          { files: filesData, caseId }
        );

        await tx.run(
          `
          UNWIND $files AS file
          WHERE file.file_category IS NOT NULL
          MERGE (cat:Category {name: file.file_category})
          WITH cat, file
          MATCH (f:File {id: file.id})
          MERGE (f)-[:IS_CATEGORIZED_AS]->(cat)
          `,
          { files: filesData }
        );

        await tx.run(
          `
          UNWIND $files AS file
          WHERE file.tags IS NOT NULL
          UNWIND file.tags AS tagName
          MERGE (t:Tag {name: tagName})
          WITH t, file
          MATCH (f:File {id: file.id})
          MERGE (f)-[:HAS_TAG]->(t)
          `,
          { files: filesData }
        );
      }

      if (insightsData && insightsData.length > 0) {
        await tx.run(
          `
          UNWIND $insights AS insight
          MERGE (i:Insight {id: insight.id})
          SET i.title = insight.title, i.description = insight.description, i.type = insight.insight_type
          WITH i, insight
          MATCH (c:Case {id: $caseId})
          MERGE (c)-[:HAS_INSIGHT]->(i)
          `,
          { insights: insightsData, caseId }
        );
      }
    });

    console.log(`Successfully completed Neo4j export for case: ${caseId}`);
    return new Response(JSON.stringify({ message: 'Case data successfully exported to Neo4j.' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error) {
    console.error('Neo4j export error:', error.message, error.stack);
    return new Response(JSON.stringify({ error: 'Failed to export to Neo4j.', details: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } finally {
    await session.close();
    await driver.close();
  }
});