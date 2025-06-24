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

    // 2. Update the case status to 'In Progress' if it was 'Analysis Complete'
    // This ensures the AI knows to re-evaluate the case with new data.
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

    // 3. Forward the new file information to the AI service
    const aiServiceEndpoint = Deno.env.get('AI_SERVICE_ENDPOINT');
    const aiServiceApiKey = Deno.env.get('AI_SERVICE_API_KEY');

    if (aiServiceEndpoint) {
      console.log(`Forwarding new file information to AI service at: ${aiServiceEndpoint}`);
      try {
        const aiResponse = await fetch(aiServiceEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${aiServiceApiKey}`,
          },
          body: JSON.stringify({
            caseId: caseId,
            userId: userId,
            newFileNames: newFileNames,
            command: 'process_additional_files', // Indicate this is for new files
            // You might also pass URLs to the uploaded files if your AI service needs direct access
            // fileUrls: newFileNames.map(name => supabaseClient.storage.from('evidence-files').getPublicUrl(`${userId}/${caseId}/${name}`).data.publicUrl)
          }),
        });

        if (!aiResponse.ok) {
          const errorBody = await aiResponse.text();
          console.error('AI Service call for new files failed:', aiResponse.status, errorBody);
          await supabaseClient.from('agent_activities').insert({
            case_id: caseId,
            agent_name: 'AI Orchestrator',
            agent_role: 'Error Handler',
            activity_type: 'AI Service Call Failed (New Files)',
            content: `Failed to trigger AI analysis for new files: ${aiResponse.status} - ${errorBody}`,
            status: 'error',
          });
          throw new Error(`AI Service call for new files failed with status ${aiResponse.status}`);
        }

        const aiResult = await aiResponse.json();
        console.log('AI Service response for new files:', aiResult);

      } catch (aiCallError: any) {
        console.error('Error during AI service invocation for new files:', aiCallError);
        await supabaseClient.from('agent_activities').insert({
          case_id: caseId,
          agent_name: 'AI Orchestrator',
          agent_role: 'Error Handler',
          activity_type: 'AI Service Invocation Error (New Files)',
          content: `Error invoking AI analysis service for new files: ${aiCallError.message}`,
          status: 'error',
        });
        throw new Error(`Error invoking AI analysis service for new files: ${aiCallError.message}`);
      }
    } else {
      console.warn('AI_SERVICE_ENDPOINT not set. New files will not be forwarded to AI for analysis.');
      await supabaseClient.from('agent_activities').insert({
        case_id: caseId,
        agent_name: 'AI Orchestrator',
        agent_role: 'Warning',
        activity_type: 'AI Service Not Configured',
        content: 'AI_SERVICE_ENDPOINT environment variable is not set. New files will not be forwarded to AI for analysis.',
        status: 'completed',
      });
    }

    return new Response(JSON.stringify({ message: 'Additional files processed successfully', caseId }), {
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