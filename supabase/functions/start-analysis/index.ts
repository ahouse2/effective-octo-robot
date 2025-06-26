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
    
    const { caseId, fileNames } = await req.json();
    const userId = await getUserIdFromRequest(req, supabaseClient);

    if (!caseId || !userId) {
      return new Response(JSON.stringify({ error: 'Case ID and User ID are required' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      });
    }

    // Insert initial records
    await supabaseClient.from('agent_activities').insert({ case_id: caseId, agent_name: 'System', agent_role: 'Setup', activity_type: 'Case Created', content: `Case record created. Ready for evidence upload.`, status: 'completed' });
    await supabaseClient.from('case_theories').insert({ case_id: caseId, status: 'initial' });

    // Process file metadata
    if (fileNames && fileNames.length > 0) {
      const fileMetadataInserts = fileNames.map((fileName: string) => ({
        case_id: caseId,
        file_name: fileName,
        file_path: `${userId}/${caseId}/${fileName}`,
      }));
      const { error: metadataError } = await supabaseClient.from('case_files_metadata').insert(fileMetadataInserts);
      
      if (metadataError) {
        console.error('Error inserting file metadata:', metadataError);
        throw new Error('Failed to create file metadata records.');
      }
    }

    return new Response(JSON.stringify({ message: 'Case created and files are uploaded. Start analysis from the Tools tab.', caseId }), {
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