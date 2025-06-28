import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import OpenAI from 'https://esm.sh/openai@4.52.7';
import { GoogleGenerativeAI } from 'https://esm.sh/@google/generative-ai@0.15.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function extractJson(text: string): string | null {
  const jsonRegex = /```json\s*([\s\S]*?)\s*```|({[\s\S]*}|\[[\s\S]*\])/;
  const match = text.match(jsonRegex);
  if (match) {
    return match[1] || match[0];
  }
  return null;
}

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

  let caseId: string | null = null;
  try {
    const body = await req.json();
    caseId = body.caseId;
    if (!caseId) throw new Error("Case ID is required.");

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    await insertAgentActivity(supabaseClient, caseId, 'Starting timeline generation process...', 'processing');

    const { data: caseData, error: caseError } = await supabaseClient
      .from('cases')
      .select('ai_model')
      .eq('id', caseId)
      .single();
    
    if (caseError || !caseData) throw new Error(`Failed to fetch case details: ${caseError?.message || 'Case not found'}`);
    const aiModel = caseData.ai_model;

    const { data: files, error: filesError } = await supabaseClient
      .from('case_files_metadata')
      .select('id, file_name, description, suggested_name')
      .eq('case_id', caseId);

    if (filesError) throw filesError;
    if (!files || files.length === 0) {
      await insertAgentActivity(supabaseClient, caseId, 'No files found to analyze for timeline.', 'completed');
      return new Response(JSON.stringify({ message: "No files to analyze." }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const evidenceContext = files.map(file => 
      `File: "${file.suggested_name || file.file_name}" (ID: ${file.id})\nSummary: ${file.description || 'No summary available.'}`
    ).join('\n\n');

    const prompt = `
      You are a specialized AI agent tasked with creating a chronological timeline of events from a set of case evidence summaries.
      Analyze the following evidence context and extract key events. For each event, provide a date (if available), a concise title, and a brief description.
      The date should be in YYYY-MM-DD format if possible. If no specific date is found, use the file's context to estimate or state "Date Unknown".
      Your response MUST be a JSON object, with a single key "timeline_events" which is an array of objects. Each object should have "event_date", "title", and "description" keys.
      Do not wrap the JSON in a markdown block.
      
      Example Response:
      {
        "timeline_events": [
          {
            "event_date": "2023-01-15",
            "title": "Financial Misconduct Alleged",
            "description": "Email from Jane Doe to John Doe alleges unauthorized transfer of funds."
          }
        ]
      }
      
      Here is the evidence context:
      ---
      ${evidenceContext}
      ---
    `;

    let responseContent: string | null = null;

    if (aiModel === 'openai') {
      const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
      if (!openaiApiKey) throw new Error("OPENAI_API_KEY is not set.");
      const openai = new OpenAI({ apiKey: openaiApiKey });
      const chatCompletion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: "json_object" },
      });
      responseContent = chatCompletion.choices[0].message.content;
    } else if (aiModel === 'gemini') {
      const geminiApiKey = Deno.env.get('GOOGLE_GEMINI_API_KEY');
      if (!geminiApiKey) throw new Error("GOOGLE_GEMINI_API_KEY is not set.");
      const genAI = new GoogleGenerativeAI(geminiApiKey);
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });
      const result = await model.generateContent(prompt);
      responseContent = result.response.text();
    } else {
      throw new Error(`Unsupported AI model: ${aiModel}`);
    }

    if (!responseContent) throw new Error("AI returned an empty response.");

    const extractedJsonString = extractJson(responseContent);
    if (!extractedJsonString) {
      throw new Error(`AI did not return a valid JSON object. Response: ${responseContent}`);
    }

    const timelineData = JSON.parse(extractedJsonString);
    const events = timelineData.timeline_events;

    if (!events || !Array.isArray(events)) throw new Error("AI response did not contain a valid 'timeline_events' array.");

    const eventsToInsert = events.map((event: any) => ({
      case_id: caseId,
      timestamp: event.event_date && event.event_date !== "Date Unknown" ? new Date(event.event_date) : new Date(),
      title: event.title,
      description: event.description,
      insight_type: 'auto_generated_event',
    }));

    if (eventsToInsert.length > 0) {
        const { error: insertError } = await supabaseClient.from('case_insights').insert(eventsToInsert);
        if (insertError) throw insertError;
    }

    await insertAgentActivity(supabaseClient, caseId, `Successfully generated and saved ${events.length} timeline events.`, 'completed');

    return new Response(JSON.stringify({ message: `Successfully generated ${events.length} timeline events.` }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error: any) {
    console.error('Timeline Generation Error:', error.message, error.stack);
    try {
      const supabaseClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
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