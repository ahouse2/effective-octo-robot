/// <import map="../../import_map.json" />
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.50.1';
import { GoogleGenerativeAI } from 'https://esm.sh/@google/generative-ai@0.15.0';
import OpenAI from 'https://esm.sh/openai@4.52.7';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
};

const MAX_CONTEXT_LENGTH = 50000; // Max characters for the combined evidence context

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

async function insertAgentActivity(supabaseClient: SupabaseClient, caseId: string, agentName: string, agentRole: string, activityType: string, content: string, status: 'processing' | 'completed' | 'error' = 'completed') {
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

async function callGeminiWithRetry<T>(
  geminiCall: () => Promise<T>,
  caseId: string,
  supabaseClient: SupabaseClient,
  activityDescription: string,
  maxRetries = 3,
  initialDelayMs = 5000 // 5 seconds
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await geminiCall();
    } catch (error: any) {
      if (error.status === 429 || (error.message && error.message.includes("quota"))) {
        const currentDelay = initialDelayMs * Math.pow(2, i);
        console.warn(`[Gemini Retry] Rate limit hit for ${activityDescription}. Retrying in ${currentDelay / 1000}s... (Attempt ${i + 1}/${maxRetries})`);
        await insertAgentActivity(supabaseClient, caseId, 'Timeline Agent', 'Chronology Specialist', 'Timeline Generation', `[Gemini] Rate limit hit for ${activityDescription}. Retrying in ${currentDelay / 1000}s...`, 'processing');
        await new Promise(resolve => setTimeout(resolve, currentDelay));
      } else {
        throw error;
      }
    }
  }
  throw new Error(`[Gemini Retry] Failed to complete ${activityDescription} after ${maxRetries} retries due to persistent rate limits or other issues.`);
}


serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  let caseId: string | null = null;
  let timelineId: string | null = null;
  let timelineName: string | null = null;

  try {
    const body = await req.json();
    caseId = body.caseId;
    const focus = body.focus;
    timelineId = body.timelineId;
    timelineName = body.timelineName;

    if (!caseId || !timelineId || !timelineName) {
      throw new Error("caseId, timelineId, and timelineName are required.");
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const activityMessage = focus 
      ? `Starting timeline generation for "${timelineName}" focused on: "${focus}"...`
      : `Starting general timeline generation for "${timelineName}"...`;
    await insertAgentActivity(supabaseClient, caseId, 'Timeline Agent', 'Chronology Specialist', 'Timeline Generation', activityMessage, 'processing');

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
      await insertAgentActivity(supabaseClient, caseId, 'Timeline Agent', 'Chronology Specialist', 'Timeline Generation', 'No files found to analyze for timeline.', 'completed');
      return new Response(JSON.stringify({ message: "No files to analyze." }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    let evidenceContext = files.map(file => 
      `File: "${file.suggested_name || file.file_name}" (ID: ${file.id})\nSummary: ${file.description || 'No summary available.'}`
    ).join('\n\n---\n\n');

    if (evidenceContext.length > MAX_CONTEXT_LENGTH) {
        await insertAgentActivity(supabaseClient, caseId, 'Timeline Agent', 'Chronology Specialist', 'Context Too Large', `Evidence context of ${evidenceContext.length} chars exceeds limit. Pre-summarizing for timeline generation...`, 'processing');
        const preSummarizationPrompt = `The following text is a collection of summaries from various legal documents. It is too long to process in its entirety for timeline generation. Please summarize this entire collection into a more concise overview, retaining only the most critical facts, names, dates, and events relevant to a legal case. Combined Summaries:\n\n${evidenceContext}`;
        
        let preSummaryResult;
        if (aiModel === 'openai') {
            const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
            if (!openaiApiKey) throw new Error("OPENAI_API_KEY is not set.");
            const openai = new OpenAI({ apiKey: openaiApiKey });
            const chatCompletion = await openai.chat.completions.create({
                model: 'gpt-4o',
                messages: [{ role: 'user', content: preSummarizationPrompt }],
            });
            preSummaryResult = chatCompletion.choices[0].message.content;
        } else { // gemini
            const geminiApiKey = Deno.env.get('GOOGLE_GEMINI_API_KEY');
            if (!geminiApiKey) throw new Error("GOOGLE_GEMINI_API_KEY is not set.");
            const genAI = new GoogleGenerativeAI(geminiApiKey);
            const modelForPreSummary = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite-preview-06-17" });
            const result = await callGeminiWithRetry(
                () => modelForPreSummary.generateContent(preSummarizationPrompt),
                caseId,
                supabaseClient,
                `pre-summarization for timeline context`
            ) as any;
            preSummaryResult = result.response.text();
        }

        if (preSummaryResult) {
            evidenceContext = preSummaryResult;
            await insertAgentActivity(supabaseClient, caseId, 'Timeline Agent', 'Chronology Specialist', 'Pre-summarization Complete', `Context reduced to ${evidenceContext.length} chars for timeline generation.`, 'completed');
        } else {
            await insertAgentActivity(supabaseClient, caseId, 'Timeline Agent', 'Chronology Specialist', 'Pre-summarization Failed', `Could not pre-summarize context. Proceeding with truncated context.`, 'error');
            evidenceContext = evidenceContext.substring(0, MAX_CONTEXT_LENGTH);
        }
    }

    const focusInstruction = focus
      ? `Your analysis MUST focus exclusively on events related to the following topic: "${focus}". Ignore any events not directly relevant to this topic.`
      : 'Extract all key events chronologically.';

    const prompt = `
      You are a specialized AI agent tasked with creating a chronological timeline of events from a set of case evidence summaries.
      Analyze the following evidence context. ${focusInstruction}
      Identify the most important events. Provide a maximum of 100 events.
      For each event, provide a date (if available, in YYYY-MM-DD format, otherwise "Date Unknown"), a concise title (under 15 words), a brief description (under 50 words), and an array of 'relevant_file_ids' (UUIDs of files from the context that directly support this event).
      Your response MUST be a JSON object, with a single key "timeline_events" which is an array of objects. Each object should have "event_date", "title", "description", and "relevant_file_ids" keys.
      
      **IMPORTANT DATE FORMAT:** Ensure 'event_date' is always in 'YYYY-MM-DD' format. If a specific date cannot be determined, use "Date Unknown".
      **CRITICAL: EXACT FILE IDs:** The 'relevant_file_ids' array MUST contain the *exact* UUIDs (e.g., "a1b2c3d4-e5f6-7890-1234-567890abcdef") of the files from the provided context that are relevant to the event. You *must* copy these IDs directly from the "ID: <UUID>" part of the file context. Do not invent or modify file IDs. If no specific file is relevant, provide an empty array [].

      Example Response:
      {
        "timeline_events": [
          {
            "event_date": "2023-01-15",
            "title": "Financial Misconduct Alleged",
            "description": "Email from Jane Doe to John Doe alleges unauthorized transfer of funds.",
            "relevant_file_ids": ["file-id-123", "file-id-456"] // These must be exact UUIDs from the context
          },
          {
            "event_date": "Date Unknown",
            "title": "General Agreement",
            "description": "Parties reached a general agreement on minor issues.",
            "relevant_file_ids": []
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
      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite-preview-06-17" });
      const result = await callGeminiWithRetry(
        () => model.generateContent(prompt),
        caseId,
        supabaseClient,
        `timeline generation for case ${caseId}`
      ) as any;
      responseContent = result.response.text();
    } else {
      throw new Error(`Unsupported AI model: ${aiModel}`);
    }

    console.log("AI Raw Response for Timeline:", responseContent);
    if (!responseContent) throw new Error("AI returned an empty response.");

    const timelineData = extractJson(responseContent);
    console.log("Parsed Timeline Data:", timelineData);
    
    if (!timelineData || !Array.isArray(timelineData.timeline_events)) {
      throw new Error(`AI did not return a valid JSON object with a 'timeline_events' array. Response: ${responseContent}`);
    }
    
    const events = timelineData.timeline_events;

    const eventsToInsert = events.map((event: any) => {
      let eventTimestamp: string | null = null; // Initialize as null
      if (event.event_date && event.event_date !== "Date Unknown") {
        const parsedDate = new Date(event.event_date);
        if (!isNaN(parsedDate.getTime())) { // Check if date is valid
          eventTimestamp = parsedDate.toISOString(); // Store as ISO string
        } else {
          console.warn(`Invalid date format from AI: ${event.event_date}. Storing timestamp as null.`);
          // eventTimestamp remains null
        }
      } else {
        // eventTimestamp remains null for "Date Unknown" or missing
      }

      return {
        case_id: caseId,
        timeline_id: timelineId, // Link to the specific timeline
        timestamp: eventTimestamp, // This will be null if "Date Unknown" or invalid
        title: event.title,
        description: event.description,
        insight_type: 'auto_generated_event',
        relevant_file_ids: Array.isArray(event.relevant_file_ids) ? event.relevant_file_ids : [], // Ensure it's an array
      };
    });

    console.log("Events to Insert:", eventsToInsert);

    if (eventsToInsert.length > 0) {
        const { error: insertError } = await supabaseClient.from('case_insights').insert(eventsToInsert);
        if (insertError) throw insertError;
    }

    await insertAgentActivity(supabaseClient, caseId, 'Timeline Agent', 'Chronology Specialist', 'Timeline Generation', `Successfully generated and saved ${events.length} timeline events for "${timelineName}".`, 'completed');

    return new Response(JSON.stringify({ message: `Successfully generated ${events.length} timeline events for "${timelineName}".` }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error: any) {
    console.error('Timeline Generation Error:', error.message, error.stack);
    if (caseId) {
      try {
        const supabaseClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
        await insertAgentActivity(supabaseClient, caseId, 'Timeline Agent', 'Chronology Specialist', 'Timeline Generation', `Error during timeline generation for "${timelineName || 'unknown timeline'}": ${error.message}`, 'error');
      } catch (logError) {
        console.error("Failed to log the primary error:", logError);
      }
    }
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});