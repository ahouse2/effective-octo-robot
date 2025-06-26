import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function getUserIdFromRequest(req: Request, supabaseClient: SupabaseClient): Promise<string | null> {
  try {
    const authHeader = req.headers.get('Authorization');
    if (authHeader) {
      const { data: { user }, error } = await supabaseClient.auth.getUser(authHeader.replace('Bearer ', ''));
      if (error) console.warn("getUserIdFromRequest: Failed to get user from JWT:", error.message);
      if (user) return user.id;
    }
    const userIdFromHeader = req.headers.get('x-supabase-user-id');
    if (userIdFromHeader) return userIdFromHeader;
    return null;
  } catch (e) {
    console.error("getUserIdFromRequest: Error getting user ID:", e);
    return null;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    );

    const { caseId, newFileNames } = await req.json();
    const userId = await getUserIdFromRequest(req, supabaseClient);

    if (!caseId || !userId || !newFileNames || !Array.isArray(newFileNames) || newFileNames.length === 0) {
      return new Response(JSON.stringify({ error: 'Case ID, User ID, and new file names are required' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      });
    }

    await supabaseClient.from('agent_activities').insert({
      case_id: caseId, agent_name: 'System', agent_role: 'File Processor',
      activity_type: 'New Evidence Received', content: `Received ${newFileNames.length} new file(s).`, status: 'completed',
    });

    // Process files in batches to avoid timeouts
    const DB_BATCH_SIZE = 100;
    for (let i = 0; i < newFileNames.length; i += DB_BATCH_SIZE) {
      const batch = newFileNames.slice(i, i + DB_BATCH_SIZE);
      const fileMetadataInserts = batch.map((relativePath: string) => ({
        case_id: caseId,
        file_name: relativePath,
        file_path: `${userId}/${caseId}/${relativePath}`,
      }));

      const { error: metadataError } = await supabaseClient
        .from('case_files_metadata')
        .insert(fileMetadataInserts);

      if (metadataError) {
        console.error('Error inserting file metadata batch:', metadataError);
        // Continue to next batch, but log the error
      }
    }
    
    return new Response(JSON.stringify({ message: 'New files uploaded. Start analysis from the Tools tab when ready.', caseId }), {
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