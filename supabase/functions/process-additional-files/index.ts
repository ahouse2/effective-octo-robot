import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Standardized helper to get user ID from either JWT (client-side) or custom header (server-side)
async function getUserIdFromRequest(req: Request, supabaseClient: SupabaseClient): Promise<string | null> {
  try {
    // 1. Try to get user from Authorization header (standard for client calls)
    const authHeader = req.headers.get('Authorization');
    if (authHeader) {
      const { data: { user }, error } = await supabaseClient.auth.getUser(authHeader.replace('Bearer ', ''));
      if (error) {
        console.warn("getUserIdFromRequest: Failed to get user from JWT:", error.message);
      }
      if (user) {
        return user.id;
      }
    }

    // 2. Fallback to custom header (for server-to-server calls)
    const userIdFromHeader = req.headers.get('x-supabase-user-id');
    if (userIdFromHeader) {
      return userIdFromHeader;
    }

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
      {
        auth: {
          persistSession: false,
        },
      }
    );

    const { caseId, newFileNames } = await req.json();
    const userId = await getUserIdFromRequest(req, supabaseClient);

    if (!caseId || !userId || !newFileNames || !Array.isArray(newFileNames) || newFileNames.length === 0) {
      return new Response(JSON.stringify({ error: 'Case ID, User ID, and new file names are required' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      });
    }

    // 1. Record an agent activity for the new files being added
    await supabaseClient.from('agent_activities').insert({
      case_id: caseId,
      agent_name: 'System',
      agent_role: 'File Processor',
      activity_type: 'New Evidence Uploaded',
      content: `User uploaded new files for analysis: ${newFileNames.join(', ')}.`,
      status: 'processing',
    });

    // 2. Record file metadata
    const fileMetadataInserts = newFileNames.map((fileName: string) => ({
      case_id: caseId,
      file_name: fileName.split('/').pop() || fileName, // Use basename for the file name
      file_path: `${userId}/${caseId}/${fileName}`, // Use the full relative path for storage path
      description: `Additional file uploaded for case ${caseId}`,
    }));

    const { data: insertedMetadata, error: metadataError } = await supabaseClient
      .from('case_files_metadata')
      .insert(fileMetadataInserts)
      .select('id, file_name, file_path');

    if (metadataError) {
      console.error('Error inserting additional file metadata:', metadataError);
      throw new Error(`Failed to record metadata for additional files: ${metadataError.message}`);
    }

    // 3. Trigger categorization and summarization for new files (fire and forget)
    if (insertedMetadata) {
      const processingPromises = insertedMetadata.flatMap(meta => [
        supabaseClient.functions.invoke('file-categorizer', {
          body: JSON.stringify({
            fileId: meta.id,
            fileName: meta.file_name,
            filePath: meta.file_path,
          }),
        }),
        supabaseClient.functions.invoke('file-summarizer', {
          body: JSON.stringify({
            fileId: meta.id,
            fileName: meta.file_name,
            filePath: meta.file_path,
          }),
        })
      ]);
      Promise.allSettled(processingPromises).then(results => {
        results.forEach(result => {
          if (result.status === 'rejected') {
            console.error("A file processing task (categorization or summarization) failed:", result.reason);
          }
        });
      });
    }

    // 4. Update case status to 'In Progress' if it was 'Analysis Complete'
    const { data: caseData, error: caseFetchError } = await supabaseClient
      .from('cases')
      .select('status')
      .eq('id', caseId)
      .single();

    if (caseFetchError) throw new Error('Failed to fetch case status.');

    if (caseData.status === 'Analysis Complete') {
      await supabaseClient
        .from('cases')
        .update({ status: 'In Progress', last_updated: new Date().toISOString() })
        .eq('id', caseId);
    }

    // 5. Invoke the AI Orchestrator to handle the AI-side processing asynchronously
    const { error: orchestratorError } = await supabaseClient.functions.invoke(
      'ai-orchestrator',
      {
        body: JSON.stringify({
          caseId: caseId,
          command: 'initiate_analysis_on_new_files',
          payload: {},
        }),
        headers: { 'Content-Type': 'application/json', 'x-supabase-user-id': userId },
      }
    );

    if (orchestratorError) {
      console.error(`Failed to invoke AI Orchestrator for new files, but user-facing tasks complete. Error: ${orchestratorError.message}`);
    }

    return new Response(JSON.stringify({ message: 'New files are being processed by the AI.', caseId }), {
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