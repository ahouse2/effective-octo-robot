import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { caseId, newFileNames } = await req.json();
    const userId = req.headers.get('x-supabase-user-id'); // Get user ID from header

    if (!caseId || !newFileNames || !Array.isArray(newFileNames) || newFileNames.length === 0) {
      return new Response(JSON.stringify({ error: 'Case ID and new file names are required' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      });
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          persistSession: false,
        },
      }
    );

    // 1. Record an agent activity for the new files being added
    const { error: activityError } = await supabaseClient
      .from('agent_activities')
      .insert({
        case_id: caseId,
        agent_name: 'System',
        agent_role: 'File Processor',
        activity_type: 'New Evidence Uploaded',
        content: `User uploaded new files for analysis: ${newFileNames.join(', ')}.`,
        status: 'processing',
      });

    if (activityError) {
      console.error('Error inserting new file activity:', activityError);
      throw new Error('Failed to record new file upload activity.');
    }

    // 2. Record file metadata and trigger categorization
    const fileMetadataInserts = newFileNames.map((fileName: string) => ({
      case_id: caseId,
      file_name: fileName,
      file_path: `${userId}/${caseId}/${fileName}`,
      description: `Additional file uploaded for case ${caseId}`,
    }));

    const { data: insertedMetadata, error: metadataError } = await supabaseClient
      .from('case_files_metadata')
      .insert(fileMetadataInserts)
      .select('id, file_name, file_path');

    if (metadataError) {
      console.error('Error inserting additional file metadata:', metadataError);
      await supabaseClient.from('agent_activities').insert({
        case_id: caseId,
        agent_name: 'System',
        agent_role: 'Database Error',
        activity_type: 'File Metadata Error',
        content: `Failed to record metadata for some additional files: ${metadataError.message}`,
        status: 'error',
      });
    } else if (insertedMetadata) {
        const categorizationPromises = insertedMetadata.map(meta =>
            supabaseClient.functions.invoke('file-categorizer', {
                body: JSON.stringify({
                    fileId: meta.id,
                    fileName: meta.file_name,
                    filePath: meta.file_path,
                }),
            })
        );
        Promise.allSettled(categorizationPromises).then(results => {
            results.forEach(result => {
                if (result.status === 'rejected') {
                    console.error("A file categorization task failed:", result.reason);
                }
            });
        });
    }

    // 3. Update the case status to 'In Progress' if it was 'Analysis Complete'
    const { data: caseData, error: caseFetchError } = await supabaseClient
      .from('cases')
      .select('status')
      .eq('id', caseId)
      .single();

    if (caseFetchError) {
      console.error('Error fetching case status:', caseFetchError);
      // Don't block, but log the error
    } else if (caseData && caseData.status === 'Analysis Complete') {
      const { error: updateCaseError } = await supabaseClient
        .from('cases')
        .update({ status: 'In Progress', last_updated: new Date().toISOString() })
        .eq('id', caseId);

      if (updateCaseError) {
        console.error('Error updating case status to In Progress:', updateCaseError);
        // Don't block, but log the error
      } else {
        // Log an activity for status change
        await supabaseClient.from('agent_activities').insert({
          case_id: caseId,
          agent_name: 'System',
          agent_role: 'Case Manager',
          activity_type: 'Case Status Update',
          content: 'Case status changed to "In Progress" due to new evidence upload.',
          status: 'completed',
        });
      }
    }

    // 4. Invoke the AI Orchestrator Edge Function
    console.log(`Invoking AI Orchestrator for new files on case: ${caseId}`);
    const { data: orchestratorResponse, error: orchestratorError } = await supabaseClient.functions.invoke(
      'ai-orchestrator',
      {
        body: JSON.stringify({
          caseId: caseId,
          command: 'process_additional_files',
          payload: { newFileNames: newFileNames },
        }),
        headers: { 'Content-Type': 'application/json', 'x-supabase-user-id': userId },
      }
    );

    if (orchestratorError) {
      console.error('Error invoking AI Orchestrator:', orchestratorError);
      await supabaseClient.from('agent_activities').insert({
        case_id: caseId,
        agent_name: 'AI Orchestrator',
        agent_role: 'Error Handler',
        activity_type: 'Orchestrator Invocation Failed (New Files)',
        content: `Failed to invoke AI Orchestrator for new files: ${orchestratorError.message}`,
        status: 'error',
      });
      throw new Error(`Failed to invoke AI Orchestrator: ${orchestratorError.message}`);
    }

    console.log('AI Orchestrator response:', orchestratorResponse);

    return new Response(JSON.stringify({ message: 'Additional files sent to AI Orchestrator successfully', caseId }), {
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