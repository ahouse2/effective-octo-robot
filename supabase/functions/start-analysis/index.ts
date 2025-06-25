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
      if (error) console.warn("getUserIdFromRequest: Failed to get user from JWT:", error.message);
      if (user) return user.id;
    }
    const userIdFromHeader = req.headers.get('x-supabase-user-id');
    if (userIdFromHeader) return userIdFromHeader;
    return null;
  } catch (e) {
    console.error("getUserIdFromRequest: Error getting user ID:", e);
    return null;
  }
}

async function insertAgentActivity(supabaseClient: SupabaseClient, caseId: string, agentName: string, agentRole: string, activityType: string, content: string, status: 'processing' | 'completed' | 'error') {
  await supabaseClient.from('agent_activities').insert({ case_id: caseId, agent_name: agentName, agent_role: agentRole, activity_type: activityType, content: content, status: status, timestamp: new Date().toISOString() });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    );
    
    const { caseId, fileNames, caseGoals, systemInstruction, aiModel, openaiAssistantId } = await req.json();
    const userId = await getUserIdFromRequest(req, supabaseClient);

    if (!caseId || !userId || !aiModel) {
      return new Response(JSON.stringify({ error: 'Case ID, User ID, and AI Model are required' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      });
    }

    // Perform quick setup tasks
    await insertAgentActivity(supabaseClient, caseId, 'System Initiator', 'Orchestrator', 'Analysis Initiation', `Analysis initiated for case ${caseId}. AI setup is running in the background.`, 'processing');
    
    await supabaseClient.from('case_theories').insert({ case_id: caseId, status: 'initial' });

    if (fileNames && fileNames.length > 0) {
      const fileMetadataInserts = fileNames.map((fileName: string) => ({
        case_id: caseId,
        file_name: fileName,
        file_path: `${userId}/${caseId}/${fileName}`,
      }));
      const { data: insertedMetadata, error: metadataError } = await supabaseClient.from('case_files_metadata').insert(fileMetadataInserts).select('id, file_name, file_path');
      
      if (metadataError) {
        console.error('Error inserting file metadata:', metadataError);
      } else if (insertedMetadata) {
        // Fire-and-forget categorization/summarization
        insertedMetadata.forEach(meta => {
          supabaseClient.functions.invoke('file-categorizer', { body: JSON.stringify({ fileId: meta.id, fileName: meta.file_name, filePath: meta.file_path }) }).catch(console.error);
          supabaseClient.functions.invoke('file-summarizer', { body: JSON.stringify({ fileId: meta.id, fileName: meta.file_name, filePath: meta.file_path }) }).catch(console.error);
        });
      }
    }

    // Asynchronously invoke the AI orchestrator to do the heavy lifting
    supabaseClient.functions.invoke(
      'ai-orchestrator',
      {
        body: JSON.stringify({
          caseId: caseId,
          command: 'setup_new_case_ai',
          payload: { caseGoals, systemInstruction, aiModel, openaiAssistantId },
        }),
        headers: { 'x-supabase-user-id': userId },
      }
    ).catch(orchestratorError => {
        console.error('Failed to invoke AI Orchestrator for new case setup:', orchestratorError);
        insertAgentActivity(supabaseClient, caseId, 'System', 'Error Handler', 'Orchestrator Invocation Failed', `Failed to start AI setup: ${orchestratorError.message}`, 'error').catch(console.error);
    });

    // Return a success response to the client immediately.
    return new Response(JSON.stringify({ message: 'Case created and AI analysis is starting in the background.', caseId }), {
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