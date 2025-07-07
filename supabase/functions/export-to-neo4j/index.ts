import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store'
};

async function neo4jQuery(wsUrl: string, query: string, params: Record<string, any>, auth: {username: string, password: string}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: "run",
        query,
        params,
        ...auth
      }));
    };

    ws.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.type === "error") {
        reject(new Error(data.message));
      } else {
        resolve(data);
      }
      ws.close();
    };

    ws.onerror = (e) => reject(new Error("WebSocket error"));
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { caseId } = await req.json();
    if (!caseId) throw new Error("Case ID is required");

    const NEO4J_WS_URL = Deno.env.get('NEO4J_WS_URL');
    const NEO4J_USER = Deno.env.get('NEO4J_USERNAME');
    const NEO4J_PASS = Deno.env.get('NEO4J_PASSWORD');
    
    if (!NEO4J_WS_URL || !NEO4J_USER || !NEO4J_PASS) {
      throw new Error('Neo4j credentials not configured');
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // 1. Get case data
    const { data: caseData, error: caseError } = await supabaseClient
      .from('cases')
      .select('*')
      .eq('id', caseId)
      .single();

    if (caseError) throw caseError;

    // 2. Create Case node
    await neo4jQuery(
      NEO4J_WS_URL,
      `MERGE (c:Case {id: $id}) 
       SET c.name = $name, 
           c.type = $type, 
           c.status = $status`,
      {
        id: caseData.id,
        name: caseData.name,
        type: caseData.type,
        status: caseData.status
      },
      {username: NEO4J_USER, password: NEO4J_PASS}
    );

    // 3. Process files (simplified example)
    const { data: files } = await supabaseClient
      .from('case_files_metadata')
      .select('*')
      .eq('case_id', caseId);

    for (const file of files || []) {
      await neo4jQuery(
        NEO4J_WS_URL,
        `MATCH (c:Case {id: $caseId})
         MERGE (f:File {id: $fileId})
         SET f.name = $fileName
         MERGE (c)-[:HAS_EVIDENCE]->(f)`,
        {
          caseId: caseData.id,
          fileId: file.id,
          fileName: file.suggested_name || file.file_name
        },
        {username: NEO4J_USER, password: NEO4J_PASS}
      );
    }

    return new Response(JSON.stringify({ message: 'Export successful' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});