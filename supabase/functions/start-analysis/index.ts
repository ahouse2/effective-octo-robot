import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.50.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
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

    await supabaseClient.from('agent_activities').insert({ case_id: caseId, agent_name: 'System', agent_role: 'Setup', activity_type: 'Case Created', content: `Case record created. Ready for evidence upload.`, status: 'completed' });
    await supabaseClient.from('case_theories').insert({ case_id: caseId, status: 'initial' });

    if (fileNames && fileNames.length > 0) {
      const fileMetadataInserts = fileNames.map((fileName: string) => ({
        case_id: caseId,
        file_name: fileName,
        file_path: `${userId}/${caseId}/${fileName}`,
      }));
      const { data: insertedMetadata, error: metadataError } = await supabaseClient.from('case_files_metadata').insert(fileMetadataInserts).select();
      
      if (metadataError) {
        console.error('Error inserting file metadata:', metadataError);
        throw new Error('Failed to create file metadata records.');
      }

      for (const meta of insertedMetadata) {
        await supabaseClient.functions.invoke('summarize-file', {
          body: { filePath: meta.file_path, fileId: meta.id, caseId: meta.case_id },
        });
      }
    }

    // Automatically generate a default "Case Overview" timeline
    const { data: defaultTimeline, error: timelineInsertError } = await supabaseClient
      .from('case_timelines')
      .insert({
        case_id: caseId,
        name: 'Case Overview',
        description: 'Automatically generated comprehensive timeline of key events.',
        generated_by: 'AI',
      })
      .select()
      .single();

    if (timelineInsertError) {
      console.error('Error creating default timeline:', timelineInsertError);
      // Don't throw, allow the rest of the function to proceed
    } else if (defaultTimeline) {
      // Trigger timeline generation for the default timeline
      await supabaseClient.functions.invoke('create-timeline-from-evidence', {
        body: { 
          caseId: caseId, 
          focus: null, // No specific focus for the overview
          timelineId: defaultTimeline.id,
          timelineName: defaultTimeline.name,
        },
      });
    }

    return new Response(JSON.stringify({ message: 'Case created and files are being summarized. You can run a full analysis once summarization is complete.', caseId }), {
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