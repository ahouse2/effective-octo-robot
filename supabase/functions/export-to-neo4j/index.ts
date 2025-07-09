import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'; // Corrected import path

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

// Helper function to send Cypher queries via Neo4j HTTP Transactional Endpoint using Basic Auth
async function neo4jHttpQuery(query: string, params: Record<string, any>, username: string, password: string, httpUrl: string) {
  const authString = btoa(`${username}:${password}`); // Base64 encode username and password
  const cleanedQuery = query.replace(/[\r\n]+/g, ' ').trim(); // Remove newlines and trim whitespace

  const response = await fetch(httpUrl, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${authString}`, // Use Basic Auth here
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      statements: [{
        statement: cleanedQuery, // Use the cleaned query
        parameters: params,
        resultDataContents: ["row"] // We only need to know if it succeeded
      }]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Neo4j HTTP error: ${response.status} ${response.statusText} - ${errorText}`);
  }

  const data = await response.json();
  if (data.errors && data.errors.length > 0) {
    throw new Error(`Neo4j query error: ${data.errors.map((e: any) => e.message).join(', ')}`);
  }
  return data;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

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

    let NEO4J_HTTP_TRANSACTION_ENDPOINT: string;
    try {
      const url = new URL(NEO4J_CONNECTION_URI);
      if (url.protocol === 'neo4j+s:') {
        // For AuraDB, the HTTP endpoint typically uses port 7473
        NEO4J_HTTP_TRANSACTION_ENDPOINT = `https://${url.hostname}:7473/db/neo4j/tx`;
      } else if (url.protocol === 'https:') {
        NEO4J_HTTP_TRANSACTION_ENDPOINT = `${url.origin}/db/neo4j/tx`;
      } else {
        throw new Error(`Unsupported protocol in NEO4J_CONNECTION_URI: ${url.protocol}. Expected 'https:', 'bolt:', 'neo4j:', or 'neo4j+s:'.`);
      }
    } catch (e) {
      throw new Error(`Invalid NEO4J_CONNECTION_URI format: ${e.message}. Please ensure it's a valid URL (e.g., https://your-instance.aura.com or bolt://your-instance.aura.com:7687 or neo4j+s://your-instance.aura.com).`);
    }

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
    await neo4jHttpQuery(
      cypherStatements.map(s => s.statement).join('; '),
      cypherStatements.reduce((acc, s) => ({ ...acc, ...s.parameters }), {}),
      NEO4J_USERNAME, NEO4J_PASSWORD,
      NEO4J_HTTP_TRANSACTION_ENDPOINT
    );

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
  }
});