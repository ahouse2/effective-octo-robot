import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import OpenAI from 'https://esm.sh/openai@4.52.7';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function insertAgentActivity(supabaseClient: SupabaseClient, caseId: string, content: string, status: 'processing' | 'completed' | 'error') {
  await supabaseClient.from('agent_activities').insert({
    case_id: caseId,
    agent_name: 'Timeline Agent',
    agent_role: 'Chronology Specialist',
    activity_type: 'Timeline Generation',
    content: content,
    status: status,
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { caseId } = await req.json();
    if (!caseId) throw new Error("Case ID is required.");

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    await insertAgentActivity(supabaseClient, caseId, 'Starting timeline generation process...', 'processing');

    // 1. Fetch all file metadata for the case
    const { data: files, error: filesError } = await supabaseClient
      .from('case_files_metadata')
      .select('id, file_name, description, suggested_name')
      .eq('case_id', caseId);

    if (filesError) throw filesError;
    if (!files || files.length === 0) {
      await insertAgentActivity(supabaseClient, caseId, 'No files found to analyze for timeline.', 'completed');
      return new Response(JSON.stringify({ message: "No files to analyze." }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // 2. Prepare the context for the AI
    const evidenceContext = files.map(file => 
      `File: "${file.suggested_name || file.file_name}" (ID: ${file.id})\nSummary: ${file.description || 'No summary available.'}`
    ).join('\n\n');

    const prompt = `
      You are a specialized AI agent tasked with creating a chronological timeline of events from a set of case evidence summaries.
      Analyze the following evidence context and extract key events. For each event, provide a date (if available), a concise title, and a brief description.
      The date should be in YYYY-MM-DD format if possible. If no specific date is found, use the file's context to estimate or state "Date Unknown".
      
      Your response MUST be a JSON object inside a markdown block, with a single key "timeline_events" which is an array of objects. Each object should have "event_date", "title", and "description" keys.
      
      Example Response:
      \`\`\`json
      {
        "timeline_events": [
          {
            "event_date": "2023-01-15",
            "title": "Financial Misconduct Alleged",
            "description": "Email from Jane Doe to John Doe alleges unauthorized transfer of funds."
          },
          {
            "event_date": "2023-02-01",
            "title": "Invoice Sent",
            "description": "Invoice #1234 for $5,000 was sent from 'ABC Corp' to John Doe."
          }
        ]
      }
      \`\`\`
      
      Here is the evidence context:
      ---
      ${evidenceContext}
      ---
    `;

    // 3. Call OpenAI to generate the timeline
    const openai = new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY') });
    const chatCompletion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: "json_object" },
    });

    const responseContent = chatCompletion.choices[0].message.content;
    if (!responseContent) throw new Error("AI returned an empty response.");

    const timelineData = JSON.parse(responseContent);
    const events = timelineData.timeline_events;

    if (!events || !Array.isArray(events)) throw new Error("AI response did not contain a valid 'timeline_events' array.");

    // 4. Insert the new timeline events into the database
    const eventsToInsert = events.map(event => ({
      case_id: caseId,
      timestamp: event.event_date !== "Date Unknown" ? new Date(event.event_date) : new Date(),
      title: event.title,
      description: event.description,
      insight_type: 'auto_generated_event', // New type for these events
    }));

    // For now, we'll insert into 'case_insights' as it has a similar structure.
    // In a future step, we might create a dedicated 'timeline_events' table.
    const { error: insertError } = await supabaseClient.from('case_insights').insert(eventsToInsert);
    if (insertError) throw insertError;

    await insertAgentActivity(supabaseClient, caseId, `Successfully generated and saved ${events.length} timeline events.`, 'completed');

    return new Response(JSON.stringify({ message: `Successfully generated ${events.length} timeline events.` }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error: any) {
    console.error('Timeline Generation Error:', error);
    // Attempt to log the error to the agent activity log
    try {
      const supabaseClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
      const { caseId } = await req.json().catch(() => ({ caseId: null }));
      if (caseId) {
        await insertAgentActivity(supabaseClient, caseId, `Error during timeline generation: ${error.message}`, 'error');
      }
    } catch (logError) {
      console.error("Failed to log the primary error:", logError);
    }
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});