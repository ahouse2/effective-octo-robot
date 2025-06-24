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
    const { caseId, promptContent } = await req.json();
    const userId = req.headers.get('x-supabase-user-id'); // Get user ID from header

    if (!caseId || !promptContent) {
      return new Response(JSON.stringify({ error: 'Case ID and prompt content are required' }), {
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

    // 1. Insert user's prompt as an agent activity
    const { error: activityError } = await supabaseClient
      .from('agent_activities')
      .insert({
        case_id: caseId,
        agent_name: 'User', // Identify the source as 'User'
        agent_role: 'Client',
        activity_type: 'User Prompt',
        content: promptContent,
        status: 'completed', // User prompts are immediately 'completed' from the user's side
      });

    if (activityError) {
      console.error('Error inserting user prompt activity:', activityError);
      throw new Error('Failed to record user prompt.');
    }

    // 2. Invoke the AI Orchestrator Edge Function
    console.log(`Invoking AI Orchestrator for user prompt on case: ${caseId}`);
    const { data: orchestratorResponse, error: orchestratorError } = await supabaseClient.functions.invoke(
      'ai-orchestrator',
      {
        body: JSON.stringify({
          caseId: caseId,
          command: 'user_prompt',
          payload: { promptContent: promptContent },
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
        activity_type: 'Orchestrator Invocation Failed',
        content: `Failed to invoke AI Orchestrator for user prompt: ${orchestratorError.message}`,
        status: 'error',
      });
      throw new Error(`Failed to invoke AI Orchestrator: ${orchestratorError.message}`);
    }

    console.log('AI Orchestrator response:', orchestratorResponse);

    return new Response(JSON.stringify({ message: 'Prompt sent to AI Orchestrator successfully', caseId }), {
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