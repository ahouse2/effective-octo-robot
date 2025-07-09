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
      throw new Error('Neo4j connection URI or credentials (Username/Password) are not set in Supabase secrets.');
    }

    // Initialize Neo4j Driver
    driver = neo4j.driver(NEO4J_CONNECTION_URI, neo4j.auth.basic(NEO4J_USERNAME, NEO4J_PASSWORD));
    session = driver.session();

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    );

    // Fetch all relevant data for the case
    const [{ data: caseData, error: caseError },
           { data: filesData, error: filesError },
           { data: insightsData, error: insightsError },
           { data: theoryData, error: theoryError }] = await Promise.all([
      supabaseClient.from('cases').select('*').eq('id', caseId).single(),
      supabaseClient.from('case_files_metadata').select('*').eq('case_id', caseId),
      supabaseClient.from('case_insights').select('*').eq('case_id', caseId),
      supabaseClient.from('case_theories').select('*').eq('case_id', caseId).single(),
    ]);

    if (caseError) throw new Error(`Failed to fetch case data: ${caseError.message}`);
    if (!caseData) throw new Error(`Case with ID ${caseId} not found.`);

    const cypherStatements: { statement: string; parameters: Record<string, any> }[] = [];

    // 1. Create or merge Case node
    cypherStatements.push({
      statement: `MERGE (c:Case {id: $caseId}) SET c.name = $name, c.type = $type, c.status = $status, c.last_updated = $last_updated`,
      parameters: {
        caseId: caseData.id,
        name: caseData.name,
        type: caseData.type,
        status: caseData.status,
        last_updated: caseData.last_updated,
      },
    });

    // 2. Create or merge File nodes and link to Case
    if (filesData && filesData.length > 0) {
      for (const file of filesData) {
        cypherStatements.push({
          statement: `
            MERGE (f:File {id: $fileId})
            SET f.file_name = $fileName, f.suggested_name = $suggestedName, f.description = $description, f.uploaded_at = $uploadedAt
            MERGE (c:Case {id: $caseId})-[r:HAS_FILE]->(f)
          `,
          parameters: {
            fileId: file.id,
            fileName: file.file_name,
            suggestedName: file.suggested_name,
            description: file.description,
            uploadedAt: file.uploaded_at,
            caseId: caseData.id,
          },
        });

        // Link to Category
        if (file.file_category) {
          cypherStatements.push({
            statement: `
              MERGE (cat:Category {name: $categoryName})
              MERGE (f:File {id: $fileId})-[r:HAS_CATEGORY]->(cat)
            `,
            parameters: { categoryName: file.file_category, fileId: file.id },
          });
        }

        // Link to Tags
        if (file.tags && file.tags.length > 0) {
          for (const tag of file.tags) {
            cypherStatements.push({
              statement: `
                MERGE (t:Tag {name: $tagName})
                MERGE (f:File {id: $fileId})-[r:HAS_TAG]->(t)
              `,
              parameters: { tagName: tag, fileId: file.id },
            });
          }
        }
      }
    }

    // 3. Create or merge Insight nodes and link to Case
    if (insightsData && insightsData.length > 0) {
      for (const insight of insightsData) {
        cypherStatements.push({
          statement: `
            MERGE (i:Insight {id: $insightId})
            SET i.title = $title, i.description = $description, i.insight_type = $insightType, i.timestamp = $timestamp
            MERGE (c:Case {id: $caseId})-[r:HAS_INSIGHT]->(i)
          `,
          parameters: {
            insightId: insight.id,
            title: insight.title,
            description: insight.description,
            insightType: insight.insight_type,
            timestamp: insight.timestamp,
            caseId: caseData.id,
          },
        });

        // Link insights to relevant files if available
        if (insight.relevant_file_ids && insight.relevant_file_ids.length > 0) {
          for (const fileId of insight.relevant_file_ids) {
            cypherStatements.push({
              statement: `
                MATCH (i:Insight {id: $insightId})
                MATCH (f:File {id: $fileId})
                MERGE (i)-[:BASED_ON_FILE]->(f)
              `,
              parameters: { insightId: insight.id, fileId: fileId },
            });
          }
        }
      }
    }

    // 4. Create or merge CaseTheory node and link to Case
    if (theoryData) {
      cypherStatements.push({
        statement: `
          MERGE (t:CaseTheory {id: $theoryId})
          SET t.status = $status, t.last_updated = $last_updated, t.fact_patterns = $fact_patterns, t.legal_arguments = $legal_arguments, t.potential_outcomes = $potential_outcomes
          MERGE (c:Case {id: $caseId})-[r:HAS_THEORY]->(t)
        `,
        parameters: {
          theoryId: theoryData.id,
          status: theoryData.status,
          last_updated: theoryData.last_updated,
          fact_patterns: theoryData.fact_patterns,
          legal_arguments: theoryData.legal_arguments,
          potential_outcomes: theoryData.potential_outcomes,
          caseId: caseData.id,
        },
      });
    }

    // Execute all Cypher statements in a single transaction
    for (const stmt of cypherStatements) {
      await session.run(stmt.statement, stmt.parameters);
    }

    return new Response(JSON.stringify({ message: 'Case data exported to Neo4j successfully!' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error: any) {
    console.error('Edge Function error:', error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  } finally {
    if (session) await session.close();
    if (driver) await driver.close();
  }
});