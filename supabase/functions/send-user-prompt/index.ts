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

    // Check for specific commands
    let aiServicePayload: any = {
      caseId: caseId,
      userId: userId,
      prompt: promptContent,
    };

    if (promptContent.startsWith('/search ')) {
      const query = promptContent.substring('/search '.length).trim();
      console.log(`Detected /search command with query: "${query}"`);
      aiServicePayload.command = 'file_search';
      aiServicePayload.query = query;

      // Log an activity indicating the search command was received
      await supabaseClient.from('agent_activities').insert({
        case_id: caseId,
        agent_name: 'Command Interpreter',
        agent_role: 'System',
        activity_type: 'Command Received',
        content: `User requested a file search for: "${query}"`,
        status: 'processing',
      });
    } else if (promptContent.startsWith('/websearch ')) { // New command for web search
      const query = promptContent.substring('/websearch '.length).trim();
      console.log(`Detected /websearch command with query: "${query}"`);
      aiServicePayload.command = 'web_search';
      aiServicePayload.query = query;

      // Log an activity indicating the web search command was received
      await supabaseClient.from('agent_activities').insert({
        case_id: caseId,
        agent_name: 'Command Interpreter',
        agent_role: 'System',
        activity_type: 'Web Search Request', // New activity type
        content: `User requested a web search for: "${query}"`,
        status: 'processing',
      });
    }
    // Add more commands here if needed (e.g., /summarize, /analyze)

    // 2. Forward the prompt (or command) to the AI service
    const aiServiceEndpoint = Deno.env.get('AI_SERVICE_ENDPOINT');
    const aiServiceApiKey = Deno.env.get('AI_SERVICE_API_KEY');

    if (aiServiceEndpoint) {
      console.log(`Forwarding user prompt/command to AI service at: ${aiServiceEndpoint}`);
      try {
        const aiResponse = await fetch(aiServiceEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${aiServiceApiKey}`,
          },
          body: JSON.stringify(aiServicePayload), // Send the parsed payload
        });

        if (!aiResponse.ok) {
          const errorBody = await aiResponse.text();
          console.error('AI Service prompt forwarding failed:', aiResponse.status, errorBody);
          await supabaseClient.from('agent_activities').insert({
            case_id: caseId,
            agent_name: 'AI Orchestrator',
            agent_role: 'Error Handler',
            activity_type: 'AI Prompt Forwarding Failed',
            content: `Failed to forward user prompt to AI service: ${aiResponse.status} - ${errorBody}`,
            status: 'error',
          });
          throw new Error(`AI Service prompt forwarding failed with status ${aiResponse.status}`);
        }

        const aiResult = await aiResponse.json();
        console.log('AI Service response to prompt:', aiResult);
        // The AI service is expected to update agent_activities and case_theories directly
        // based on the prompt/command.

      } catch (aiCallError: any) {
        console.error('Error during AI service prompt invocation:', aiCallError);
        await supabaseClient.from('agent_activities').insert({
          case_id: caseId,
          agent_name: 'AI Orchestrator',
          agent_role: 'Error Handler',
          activity_type: 'AI Prompt Invocation Error',
          content: `Error invoking AI analysis service with user prompt: ${aiCallError.message}`,
          status: 'error',
        });
        throw new Error(`Error invoking AI analysis service with user prompt: ${aiCallError.message}`);
      }
    } else {
      console.warn('AI_SERVICE_ENDPOINT not set. User prompt/command will not be forwarded to AI.');
      await supabaseClient.from('agent_activities').insert({
        case_id: caseId,
        agent_name: 'AI Orchestrator',
        agent_role: 'Warning',
        activity_type: 'AI Service Not Configured',
        content: 'AI_SERVICE_ENDPOINT environment variable is not set. User prompt/command will not be forwarded to AI.',
        status: 'completed',
      });
    }

    return new Response(JSON.stringify({ message: 'Prompt sent successfully', caseId }), {
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