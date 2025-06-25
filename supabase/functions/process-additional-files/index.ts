import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import OpenAI from 'https://esm.sh/openai@4.52.7';

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

    if (!caseId || !userId || !newFileNames || !Array.isArray(newFileNames) || newFileNames.length === 0) {
      return new Response(JSON.stringify({ error: 'Case ID, User ID, and new file names are required' }), {
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
      throw new Error(`Failed to record metadata for additional files: ${metadataError.message}`);
    }

    // 3. Trigger categorization for new files
    if (insertedMetadata) {
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

    // 4. Fetch case AI model
    const { data: caseData, error: caseFetchError } = await supabaseClient
      .from('cases')
      .select('ai_model, status')
      .eq('id', caseId)
      .single();

    if (caseFetchError || !caseData) {
      throw new Error('Failed to fetch case details to determine AI model.');
    }

    let attachments: { file_id: string; tools: { type: string }[] }[] = [];

    // 5. If OpenAI, upload files to OpenAI and update metadata
    if (caseData.ai_model === 'openai' && insertedMetadata) {
      const openai = new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY') });
      for (const meta of insertedMetadata) {
        const { data: fileBlob, error: downloadError } = await supabaseClient.storage
          .from('evidence-files')
          .download(meta.file_path);

        if (downloadError || !fileBlob) {
          console.error(`Failed to download ${meta.file_name} for OpenAI upload:`, downloadError);
          continue;
        }

        try {
          const openaiFile = await openai.files.create({
            file: new File([fileBlob], meta.file_name),
            purpose: 'assistants',
          });
          attachments.push({ file_id: openaiFile.id, tools: [{ type: "file_search" }] });

          await supabaseClient
            .from('case_files_metadata')
            .update({ openai_file_id: openaiFile.id })
            .eq('id', meta.id);
        } catch (uploadError) {
          console.error(`Failed to upload ${meta.file_name} to OpenAI:`, uploadError);
        }
      }
    }

    // 6. Update case status to 'In Progress' if it was 'Analysis Complete'
    if (caseData.status === 'Analysis Complete') {
      await supabaseClient
        .from('cases')
        .update({ status: 'In Progress', last_updated: new Date().toISOString() })
        .eq('id', caseId);
      await supabaseClient.from('agent_activities').insert({
        case_id: caseId,
        agent_name: 'System',
        agent_role: 'Case Manager',
        activity_type: 'Case Status Update',
        content: 'Case status changed to "In Progress" due to new evidence upload.',
        status: 'completed',
      });
    }

    // 7. Invoke the AI Orchestrator Edge Function
    const { error: orchestratorError } = await supabaseClient.functions.invoke(
      'ai-orchestrator',
      {
        body: JSON.stringify({
          caseId: caseId,
          command: 'process_additional_files',
          payload: { 
            newFileNames: newFileNames,
            attachments: attachments, // Pass the attachments for OpenAI
          },
        }),
        headers: { 'Content-Type': 'application/json', 'x-supabase-user-id': userId },
      }
    );

    if (orchestratorError) {
      throw new Error(`Failed to invoke AI Orchestrator: ${orchestratorError.message}`);
    }

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