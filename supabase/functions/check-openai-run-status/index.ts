import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import OpenAI from 'https://esm.sh/openai@4.52.7';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function extractJson(text: string): any | null {
  const jsonRegex = /```json\s*([\s\S]*?)\s*```|({[\s\S]*}|\[[\s\S]*\])/;
  const match = text.match(jsonRegex);
  if (match) {
    const jsonString = match[1] || match[2];
    if (jsonString) {
        try {
            return JSON.parse(jsonString);
        } catch (e) {
            console.error("Failed to parse extracted JSON string:", jsonString, e);
            return null;
        }
    }
  }
  return null;
}

async function updateProgress(supabaseClient: SupabaseClient, caseId: string, progress: number, message: string) {
    await supabaseClient.from('cases').update({ analysis_progress: progress, analysis_status_message: message }).eq('id', caseId);
}

async function insertAgentActivity(supabaseClient: SupabaseClient, caseId: string, agentName: string, agentRole: string, activityType: string, content: string, status: 'processing' | 'completed' | 'error') {
  const { error } = await supabaseClient.from('agent_activities').insert({
    case_id: caseId,
    agent_name: agentName,
    agent_role: agentRole,
    activity_type: activityType,
    content: content,
    status: status,
  });
  if (error) console.error(`Failed to insert agent activity [${activityType}]`, error);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  let caseIdFromRequest: string | null = null;
  try {
    const body = await req.json();
    const { caseId, threadId, runId } = body;
    caseIdFromRequest = caseId;

    if (!caseId || !threadId || !runId) {
      return new Response(JSON.stringify({ error: 'caseId, threadId, and runId are required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const supabaseClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    const openai = new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY') });

    const run = await openai.beta.threads.runs.retrieve(threadId, runId);

    if (run.status === 'completed') {
      await updateProgress(supabaseClient, caseId, 80, 'Analysis complete. Parsing results...');
      const messages = await openai.beta.threads.messages.list(threadId, { limit: 1 });
      const lastMessage = messages.data[0];
      
      if (lastMessage && lastMessage.content[0].type === 'text') {
        const responseText = lastMessage.content[0].text.value;
        const jsonResult = extractJson(responseText);

        if (!jsonResult) {
          throw new Error("AI response did not contain valid JSON.");
        }

        if (jsonResult.case_theory) {
            await supabaseClient.from('case_theories').upsert({
                case_id: caseId,
                fact_patterns: jsonResult.case_theory.fact_patterns,
                legal_arguments: jsonResult.case_theory.legal_arguments,
                potential_outcomes: jsonResult.case_theory.potential_outcomes,
                status: 'refined',
                last_updated: new Date().toISOString()
            }, { onConflict: 'case_id' });
        }

        if (jsonResult.case_insights && jsonResult.case_insights.length > 0) {
            await supabaseClient.from('case_insights').delete().eq('case_id', caseId);
            const insightsToInsert = jsonResult.case_insights.map((insight: any) => ({
                case_id: caseId,
                title: insight.title,
                description: insight.description,
                insight_type: insight.insight_type
            }));
            await supabaseClient.from('case_insights').insert(insightsToInsert);
        }
        
        await insertAgentActivity(supabaseClient, caseId, 'OpenAI Assistant', 'AI', 'Full Analysis Complete', `Successfully parsed and saved new case theory and ${jsonResult.case_insights?.length || 0} insights.`, 'completed');
        await supabaseClient.from('cases').update({ status: 'Analysis Complete' }).eq('id', caseId);
        await updateProgress(supabaseClient, caseId, 100, 'Analysis complete!');

        return new Response(JSON.stringify({ message: 'Analysis complete and data saved.' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    } else if (run.status === 'in_progress' || run.status === 'queued') {
      await updateProgress(supabaseClient, caseId, 60, `Analysis is ${run.status}. Checking again shortly...`);
      
      setTimeout(() => {
        supabaseClient.functions.invoke('check-openai-run-status', {
          body: { caseId, threadId, runId },
        }).catch(console.error);
      }, 10000);

      return new Response(JSON.stringify({ message: 'Analysis in progress, scheduled next check.' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    } else {
      throw new Error(`Run failed with status: ${run.status}. Last error: ${JSON.stringify(run.last_error)}`);
    }
  } catch (error: any) {
    console.error('Check Run Status Error:', error.message);
    const supabaseClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    if (caseIdFromRequest) {
        await insertAgentActivity(supabaseClient, caseIdFromRequest, 'OpenAI Assistant', 'Error Handler', 'Analysis Failed', error.message, 'error');
        await supabaseClient.from('cases').update({ status: 'Error', analysis_status_message: error.message }).eq('id', caseIdFromRequest);
    }
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});