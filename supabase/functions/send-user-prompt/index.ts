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
      if (error) {
        console.warn("getUserIdFromRequest (send-user-prompt): Failed to get user from JWT:", error.message);
      }
      if (user) {
        return user.id;
      }
    }
    return null;
  } catch (e) {
    console.error("getUserIdFromRequest (send-user-prompt): Error getting user ID:", e);
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

    const { caseId, promptContent } = await req.json();
    const userId = await getUserIdFromRequest(req, supabaseClient);

    if (!caseId || !promptContent || !userId) {
      return new Response(JSON.stringify({ error: 'Case ID, prompt content, and user authentication are required' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      });
    }

    // 1. Insert user's prompt as an agent activity
    const { error: activityError } = await supabaseClient
      .from('agent_activities')
      .insert({
        case_id: caseId,
        agent_name: 'User',
        agent_role: 'Client',
        activity_type: 'User Prompt',
        content: promptContent,
        status: 'completed',
      });

    if (activityError) {
      console.error('Error inserting user prompt activity:', activityError);
      throw new Error('Failed to record user prompt.');
    }

    // 2. Parse for @-mentioned filename
    const mentionRegex = /@([\w.-]+)/;
    const match = promptContent.match(mentionRegex);

    let mentionedFilename = null;
    let finalPrompt = promptContent;

    if (match) {
      mentionedFilename = match[1];
      finalPrompt = promptContent.replace(mentionRegex, '').trim();
      console.log(`User mentioned file: ${mentionedFilename}. Remaining prompt: "${finalPrompt}"`);
    }

    // 3. Invoke the AI Orchestrator Edge Function
    console.log(`Invoking AI Orchestrator for user prompt on case: ${caseId}`);
    const { data: orchestratorResponse, error: orchestratorError } = await supabaseClient.functions.invoke(
      'ai-orchestrator',
      {
        body: JSON.stringify({
          caseId: caseId,
          command: 'user_prompt',
          payload: { 
            promptContent: finalPrompt,
            mentionedFilename: mentionedFilename
          },
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