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
    const { caseId, fileNames, caseGoals } = await req.json(); // Receive caseGoals

    if (!caseId) {
      return new Response(JSON.stringify({ error: 'Case ID is required' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      });
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', // Use service role key for server-side operations
      {
        auth: {
          persistSession: false,
        },
      }
    );

    // Insert initial agent activity: Analysis initiated
    const { error: activityError } = await supabaseClient
      .from('agent_activities')
      .insert({
        case_id: caseId,
        agent_name: 'System Initiator',
        agent_role: 'Orchestrator',
        activity_type: 'Analysis Initiation',
        content: `Analysis initiated for case ${caseId}. Files received: ${fileNames.join(', ')}. Case Goals: ${caseGoals || 'Not specified'}.`, // Include case goals
        status: 'processing',
      });

    if (activityError) {
      console.error('Error inserting initial activity:', activityError);
      throw new Error('Failed to insert initial agent activity.');
    }

    // Insert initial case theory
    const { error: theoryError } = await supabaseClient
      .from('case_theories')
      .insert({
        case_id: caseId,
        fact_patterns: [],
        legal_arguments: [],
        potential_outcomes: [],
        status: 'initial',
      });

    if (theoryError) {
      console.error('Error inserting initial case theory:', theoryError);
      throw new Error('Failed to insert initial case theory.');
    }

    // --- AI Model/Agent Integration Placeholder ---
    // This is where you would make an API call to your external AI service or agent system.
    // The AI service would then process the files (which are now in Supabase Storage)
    // and update the 'agent_activities' and 'case_theories' tables as it progresses.

    const aiServiceEndpoint = Deno.env.get('AI_SERVICE_ENDPOINT'); // You would set this as a Supabase secret
    const aiServiceApiKey = Deno.env.get('AI_SERVICE_API_KEY'); // You would set this as a Supabase secret

    if (aiServiceEndpoint) {
      console.log(`Attempting to call AI service at: ${aiServiceEndpoint}`);
      try {
        const aiResponse = await fetch(aiServiceEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${aiServiceApiKey}`, // Use your AI service's API key
          },
          body: JSON.stringify({
            caseId: caseId,
            userId: req.headers.get('x-supabase-user-id'), // Pass user ID if needed by AI service
            fileNames: fileNames,
            caseGoals: caseGoals, // Pass case goals to AI service
            // You might also pass URLs to the uploaded files if your AI service needs direct access
            // fileUrls: fileNames.map(name => supabaseClient.storage.from('evidence-files').getPublicUrl(`${req.headers.get('x-supabase-user-id')}/${caseId}/${name}`).data.publicUrl)
          }),
        });

        if (!aiResponse.ok) {
          const errorBody = await aiResponse.text();
          console.error('AI Service call failed:', aiResponse.status, errorBody);
          // Optionally, log an error activity to the database
          await supabaseClient.from('agent_activities').insert({
            case_id: caseId,
            agent_name: 'AI Orchestrator',
            agent_role: 'Error Handler',
            activity_type: 'AI Service Call Failed',
            content: `Failed to trigger AI analysis: ${aiResponse.status} - ${errorBody}`,
            status: 'error',
          });
          throw new Error(`AI Service call failed with status ${aiResponse.status}`);
        }

        const aiResult = await aiResponse.json();
        console.log('AI Service response:', aiResult);
        // The AI service would ideally update the database directly,
        // but you could also process its initial response here.

      } catch (aiCallError) {
        console.error('Error during AI service invocation:', aiCallError);
        // Log an error activity if the fetch call itself fails
        await supabaseClient.from('agent_activities').insert({
          case_id: caseId,
          agent_name: 'AI Orchestrator',
          agent_role: 'Error Handler',
          activity_type: 'AI Service Invocation Error',
          content: `Error invoking AI analysis service: ${aiCallError.message}`,
          status: 'error',
        });
        throw new Error(`Error invoking AI analysis service: ${aiCallError.message}`);
      }
    } else {
      console.warn('AI_SERVICE_ENDPOINT not set. AI analysis will not be triggered.');
      // Optionally, log a warning activity
      await supabaseClient.from('agent_activities').insert({
        case_id: caseId,
        agent_name: 'AI Orchestrator',
        agent_role: 'Warning',
        activity_type: 'AI Service Not Configured',
        content: 'AI_SERVICE_ENDPOINT environment variable is not set. AI analysis will not be triggered.',
        status: 'completed', // Or 'error' depending on desired behavior
      });
    }
    // --- End AI Model/Agent Integration Placeholder ---

    return new Response(JSON.stringify({ message: 'Analysis initiated successfully', caseId }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error('Edge Function error:', error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});