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
    const { caseId, fileNames } = await req.json();

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

    // Insert initial agent activity
    const { error: activityError } = await supabaseClient
      .from('agent_activities')
      .insert({
        case_id: caseId,
        agent_name: 'System Initiator',
        agent_role: 'Orchestrator',
        activity_type: 'Analysis Start',
        content: `Analysis initiated for case ${caseId}. Files received: ${fileNames.join(', ')}.`,
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