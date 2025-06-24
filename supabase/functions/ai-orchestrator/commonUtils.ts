import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

// Helper function to extract JSON from markdown code blocks
export function extractJsonFromMarkdown(text: string): any | null {
  const jsonBlockRegex = /```json\n([\s\S]*?)\n```/;
  const match = text.match(jsonBlockRegex);
  if (match && match[1]) {
    try {
      return JSON.parse(match[1]);
    } catch (e) {
      console.error("Failed to parse JSON from markdown:", e);
      return null;
    }
  }
  return null;
}

// Helper function to update case theory and insights
export async function updateCaseData(supabaseClient: SupabaseClient, caseId: string, assistantResponse: string) {
  const structuredData = extractJsonFromMarkdown(assistantResponse);

  if (structuredData) {
    if (structuredData.theory_update) {
      const { error: theoryUpdateError } = await supabaseClient
        .from('case_theories')
        .update({
          fact_patterns: structuredData.theory_update.fact_patterns,
          legal_arguments: structuredData.theory_update.legal_arguments,
          potential_outcomes: structuredData.theory_update.potential_outcomes,
          status: structuredData.theory_update.status,
          last_updated: new Date().toISOString(),
        })
        .eq('case_id', caseId);
      if (theoryUpdateError) console.error('Error updating case theory:', theoryUpdateError);
    }
    if (structuredData.insights && Array.isArray(structuredData.insights)) {
      for (const insight of structuredData.insights) {
        const { error: insightInsertError } = await supabaseClient
          .from('case_insights')
          .insert({
            case_id: caseId,
            title: insight.title,
            description: insight.description,
            insight_type: insight.insight_type || 'general',
            timestamp: new Date().toISOString(),
          });
        if (insightInsertError) console.error('Error inserting case insight:', insightInsertError);
      }
    }
  }
}

// Helper function to insert agent activities
export async function insertAgentActivity(
  supabaseClient: SupabaseClient,
  caseId: string,
  agentName: string,
  agentRole: string,
  activityType: string,
  content: string,
  status: 'processing' | 'completed' | 'error'
) {
  const { error } = await supabaseClient
    .from('agent_activities')
    .insert({
      case_id: caseId,
      agent_name: agentName,
      agent_role: agentRole,
      activity_type: activityType,
      content: content,
      status: status,
      timestamp: new Date().toISOString(),
    });
  if (error) {
    console.error(`Error inserting agent activity (${activityType}):`, error);
  }
}