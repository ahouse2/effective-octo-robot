import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { caseId } = await req.json();
    if (!caseId) throw new Error("Case ID is required.");

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    );

    const [
      { data: caseData, error: caseError },
      { data: theoryData, error: theoryError },
      { data: insightsData, error: insightsError },
      { data: filesData, error: filesError },
      { data: timelineEventsData, error: timelineEventsError }
    ] = await Promise.all([
      supabaseClient.from('cases').select('*').eq('id', caseId).single(),
      supabaseClient.from('case_theories').select('*').eq('case_id', caseId).single(),
      supabaseClient.from('case_insights').select('*').eq('case_id', caseId).not('insight_type', 'eq', 'auto_generated_event').order('timestamp', { ascending: true }),
      supabaseClient.from('case_files_metadata').select('*').eq('case_id', caseId).order('uploaded_at', { ascending: true }),
      supabaseClient.from('case_insights').select('*').eq('case_id', caseId).eq('insight_type', 'auto_generated_event').order('timestamp', { ascending: true })
    ]);

    if (caseError) throw new Error(`Failed to fetch case details: ${caseError.message}`);
    if (!caseData) throw new Error(`Case with ID ${caseId} not found.`);

    let report = `# Case Report: ${caseData.name}\n\n`;
    report += `**Case ID:** ${caseData.id}\n`;
    report += `**Case Type:** ${caseData.type}\n`;
    report += `**Current Status:** ${caseData.status}\n`;
    report += `**Last Updated:** ${new Date(caseData.last_updated).toLocaleString()}\n\n`;
    report += `## Case Directives\n\n`;
    report += `### Primary Goals\n${caseData.case_goals || 'Not specified.'}\n\n`;
    report += `### System Instructions for AI\n${caseData.system_instruction || 'Not specified.'}\n\n`;
    report += `### User-Specified Legal Arguments\n${caseData.user_specified_arguments || 'Not specified.'}\n\n`;

    report += `## AI-Generated Case Theory\n\n`;
    if (theoryData) {
      report += `**Status:** ${theoryData.status}\n`;
      report += `**Last Updated:** ${new Date(theoryData.last_updated).toLocaleString()}\n\n`;
      report += `### Fact Patterns\n`;
      if (theoryData.fact_patterns && theoryData.fact_patterns.length > 0) {
        theoryData.fact_patterns.forEach((fact: string) => report += `- ${fact}\n`);
      } else {
        report += `No fact patterns identified yet.\n`;
      }
      report += `\n`;

      report += `### Legal Arguments\n`;
      if (theoryData.legal_arguments && theoryData.legal_arguments.length > 0) {
        theoryData.legal_arguments.forEach((arg: string) => report += `- ${arg}\n`);
      } else {
        report += `No legal arguments identified yet.\n`;
      }
      report += `\n`;

      report += `### Potential Outcomes\n`;
      if (theoryData.potential_outcomes && theoryData.potential_outcomes.length > 0) {
        theoryData.potential_outcomes.forEach((outcome: string) => report += `- ${outcome}\n`);
      } else {
        report += `No potential outcomes identified yet.\n`;
      }
      report += `\n`;
    } else {
      report += `No case theory has been generated yet.\n\n`;
    }

    report += `## AI-Generated Key Insights\n\n`;
    if (insightsData && insightsData.length > 0) {
      insightsData.forEach((insight: any) => {
        report += `### ${insight.title} (${insight.insight_type})\n`;
        report += `*Generated on: ${new Date(insight.timestamp).toLocaleString()}*\n\n`;
        report += `${insight.description}\n\n`;
      });
    } else {
      report += `No key insights have been generated yet.\n\n`;
    }

    report += `## Timeline of Key Events\n\n`;
    if (timelineEventsData && timelineEventsData.length > 0) {
        timelineEventsData.forEach((event: any) => {
            report += `**${new Date(event.timestamp).toLocaleDateString()}**: ${event.title}\n`;
            report += `> ${event.description}\n\n`;
        });
    } else {
        report += `No timeline events have been generated yet.\n\n`;
    }

    report += `## Evidence Log\n\n`;
    if (filesData && filesData.length > 0) {
      report += `| Suggested Filename | Category | SHA-256 Hash | Summary |\n`;
      report += `|--------------------|----------|--------------|---------|\n`;
      filesData.forEach((file: any) => {
        report += `| ${file.suggested_name || 'N/A'} | ${file.file_category || 'Uncategorized'} | ${file.file_hash || 'Not calculated'} | ${file.description || 'No summary.'} |\n`;
      });
    } else {
      report += `No evidence files have been uploaded for this case.\n`;
    }

    const caseNameForFile = caseData.name.replace(/\s+/g, '_');
    const fileName = `Case_Report_${caseNameForFile}_${caseId}.md`;

    return new Response(report, {
      headers: { 
        ...corsHeaders, 
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="${fileName}"`
      },
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