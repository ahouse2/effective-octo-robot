import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import OpenAI from 'https://esm.sh/openai@4.52.7';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const openai = new OpenAI({
  apiKey: Deno.env.get('OPENAI_API_KEY'),
});

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { fileId, fileName, filePath } = await req.json();

    if (!fileId || !fileName || !filePath) {
      throw new Error('fileId, fileName, and filePath are required.');
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    );

    const { data: fileBlob, error: downloadError } = await supabaseClient.storage
      .from('evidence-files')
      .download(filePath);

    if (downloadError) {
      throw new Error(`Failed to download file ${fileName}: ${downloadError.message}`);
    }

    let prompt: string;

    try {
      const fileContent = await fileBlob.text();
      const contentSnippet = fileContent.substring(0, 8000);
      prompt = `
        Analyze the content of the following legal document snippet.
        Original Filename: "${fileName}"
        Content Snippet: "${contentSnippet}"

        Based on this information, please perform two tasks:
        1.  Generate a concise, one-to-two sentence summary of the document's purpose and key contents.
        2.  Extract a list of 3-5 relevant keywords or tags (as a JSON array of strings) that describe the main topics, people, or entities mentioned.

        Respond ONLY with a JSON object in the format:
        {
          "summary": "Your one or two sentence summary here.",
          "tags": ["tag1", "tag2", "tag3"]
        }
      `;
    } catch (e) {
      console.warn(`Could not read file ${fileName} as text. Falling back to filename analysis for summary.`);
      prompt = `
        The content of the file named "${fileName}" could not be read as text, suggesting it is a binary file (e.g., an image).
        Based on its filename, provide a simple summary and tags.

        Respond ONLY with a JSON object in the format:
        {
          "summary": "Binary file (e.g., image, scan) with original name: ${fileName}",
          "tags": ["binary file", "image/scan"]
        }
      `;
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    });

    const result = JSON.parse(completion.choices[0].message.content || '{}');
    
    const summary = typeof result.summary === 'string' ? result.summary : null;
    let tags = null;
    if (Array.isArray(result.tags)) {
      tags = result.tags.map(tag => String(tag));
    }

    if (!summary && !tags) {
      throw new Error('AI failed to return any valid data.');
    }

    const { error: updateError } = await supabaseClient
      .from('case_files_metadata')
      .update({
        description: summary,
        tags: tags,
      })
      .eq('id', fileId);

    if (updateError) {
      throw new Error(`Failed to update file metadata with summary and tags: ${updateError.message}`);
    }

    return new Response(JSON.stringify({ message: 'File summarized and tagged successfully' }), {
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