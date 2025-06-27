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

  const supabaseClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
  const driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USERNAME, NEO4J_PASSWORD));
  const session = driver.session({ database: 'neo4j' });

  try {
    // Fetch all data for the case
    const { data: caseData, error: caseError } = await supabaseClient.from('cases').select('*').eq('id', caseId).single();
    if (caseError) throw new Error(`Failed to fetch case: ${caseError.message}`);

    const { data: filesData, error: filesError } = await supabaseClient.from('case_files_metadata').select('*').eq('case_id', caseId);
    if (filesError) throw new Error(`Failed to fetch files: ${filesError.message}`);

    const { data: insightsData, error: insightsError } = await supabaseClient.from('case_insights').select('*').eq('case_id', caseId);
    if (insightsError) throw new Error(`Failed to fetch insights: ${insightsError.message}`);

    // Use a transaction to create the graph
    await session.executeWrite(async (tx) => {
      // Create Case Node
      await tx.run(
        'MERGE (c:Case {id: $id}) SET c.name = $name, c.type = $type, c.status = $status',
        { id: caseData.id, name: caseData.name, type: caseData.type, status: caseData.status }
      );

      // Create File, Category, and Tag Nodes and Relationships
      for (const file of filesData || []) {
        await tx.run(
          `
          MERGE (f:File {id: $id}) SET f.name = $name, f.suggestedName = $suggestedName
          WITH f
          MATCH (c:Case {id: $caseId})
          MERGE (c)-[:HAS_EVIDENCE]->(f)
          `,
          { id: file.id, name: file.file_name, suggestedName: file.suggested_name, caseId: caseId }
        );

        if (file.file_category) {
          await tx.run(
            `
            MERGE (cat:Category {name: $categoryName})
            WITH cat
            MATCH (f:File {id: $fileId})
            MERGE (f)-[:IS_CATEGORIZED_AS]->(cat)
            `,
            { categoryName: file.file_category, fileId: file.id }
          );
        }

        for (const tag of file.tags || []) {
          await tx.run(
            `
            MERGE (t:Tag {name: $tagName})
            WITH t
            MATCH (f:File {id: $fileId})
            MERGE (f)-[:HAS_TAG]->(t)
            `,
            { tagName: tag, fileId: file.id }
          );
        }
      }

      // Create Insight Nodes and Relationships
      for (const insight of insightsData || []) {
        await tx.run(
          `
          MERGE (i:Insight {id: $id}) SET i.title = $title, i.description = $description, i.type = $type
          WITH i
          MATCH (c:Case {id: $caseId})
          MERGE (c)-[:HAS_INSIGHT]->(i)
          `,
          { id: insight.id, title: insight.title, description: insight.description, type: insight.insight_type, caseId: caseId }
        );
      }
    });

    return new Response(JSON.stringify({ message: 'Case data successfully exported to Neo4j.' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error) {
    console.error('Neo4j export error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } finally {
    await session.close();
    await driver.close();
  }
});