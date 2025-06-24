import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import OpenAI from 'https://esm.sh/openai@4.52.7';
import { handleOpenAICommand } from './openaiHandler.ts';
import { handleGeminiCommand } from './geminiHandler.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Main serve function
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { caseId, command, payload } = await req.json();
    const userId = req.headers.get('x-supabase-user-id');

    if (!caseId || !userId || !command || !payload) {
      return new Response(JSON.stringify({ error: 'caseId, userId, command, and payload are required' }), {
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

    const { data: caseData, error: caseError } = await supabaseClient
      .from('cases')
      .select('ai_model, openai_thread_id, openai_assistant_id, gemini_chat_history')
      .eq('id', caseId)
      .single();

    if (caseError || !caseData) {
      console.error('Error fetching case data:', caseError);
      throw new Error('Case not found or error fetching case details.');
    }

    const { ai_model, openai_thread_id, openai_assistant_id, gemini_chat_history } = caseData;

    let responseMessage = '';

    if (ai_model === 'openai') {
      if (!openai_thread_id || !openai_assistant_id) {
        throw new Error('OpenAI thread or assistant ID missing for this case.');
      }
      const openai = new OpenAI({
        apiKey: Deno.env.get('OPENAI_API_KEY'),
      });
      responseMessage = await handleOpenAICommand(
        supabaseClient,
        openai,
        caseId,
        userId,
        command,
        payload,
        openaiThreadId,
        openaiAssistantId
      );
    } else if (ai_model === 'gemini') {
      responseMessage = await handleGeminiCommand(
        supabaseClient,
        caseId,
        command,
        payload,
        gemini_chat_history || []
      );
    } else {
      throw new Error(`Unsupported AI model: ${ai_model}`);
    }

    return new Response(JSON.stringify({ message: responseMessage, caseId }), {
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