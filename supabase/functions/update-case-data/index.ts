import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { caseId, updateType, payload } = await req.json();

    if (!caseId || !updateType || !payload) {
      return new Response(JSON.stringify({ error: 'caseId, updateType, and payload are required' }), {
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

    let responseMessage = '';

    if (updateType === 'case_theory') {
      const { error } = await supabaseClient
        .from('case_theories')
        .update({
          fact_patterns: payload.fact_patterns,
          legal_arguments: payload.legal_arguments,
          potential_outcomes: payload.potential_outcomes,
          status: payload.status,
          last_updated: new Date().toISOString(),
        })
        .eq('case_id', caseId);

      if (error) {
        console.error('Error updating case theory:', error);
        throw new Error('Failed to update case theory: ' + error.message);
      }
      responseMessage = 'Case theory updated successfully.';
    } else if (updateType === 'case_insight') {
      const { error } = await supabaseClient
        .from('case_insights')
        .insert({
          case_id: caseId,
          title: payload.title,
          description: payload.description,
          insight_type: payload.insight_type || 'general',
          timestamp: new Date().toISOString(),
        });

      if (error) {
        console.error('Error inserting case insight:', error);
        throw new Error('Failed to insert case insight: ' + error.message);
      }
      responseMessage = 'Case insight added successfully.';
    } else if (updateType === 'agent_activity') {
      const { error } = await supabaseClient
        .from('agent_activities')
        .insert({
          case_id: caseId,
          agent_name: payload.agent_name,
          agent_role: payload.agent_role,
          activity_type: payload.activity_type,
          content: payload.content,
          status: payload.status,
          timestamp: new Date().toISOString(),
        });

      if (error) {
        console.error('Error inserting agent activity:', error);
        throw new Error('Failed to insert agent activity: ' + error.message);
      }
      responseMessage = 'Agent activity added successfully.';
    }
    else {
      return new Response(JSON.stringify({ error: 'Invalid updateType' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      });
    }

    return new Response(JSON.stringify({ message: responseMessage }), {
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