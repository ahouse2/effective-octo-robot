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

    const fileContent = await fileBlob.text();
    const contentSnippet = fileContent.substring(0, 4000);

    const prompt = `
      Analyze the metadata and content snippet of the following legal document.
      Original Filename: "${fileName}"
      Content Snippet: "${contentSnippet}"

      Based on this information, provide a logical category and a new, descriptive filename.
      The filename should follow the format: YYYY-MM-DD_Document-Type_Brief-Description.ext
      - The date should be the most prominent date found in the document. If none, use today's date.
      - Document-Type should be a concise category (e.g., Financial-Statement, Email, Court-Order, Property-Deed, Declaration).
      - Brief-Description should be a few keywords summarizing the content.
      - Keep the original file extension.
      - IMPORTANT: The new filename must not contain any slashes ('/' or '\\').

      Respond ONLY with a JSON object in the format:
      {
        "category": "Your Suggested Category",
        "suggestedName": "Your-Suggested-Filename.ext"
      }
    `;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    });

    const result = JSON.parse(completion.choices[0].message.content || '{}');
    let { category, suggestedName } = result;

    if (!category || !suggestedName) {
      throw new Error('AI failed to return a valid category and suggested name.');
    }

    // Sanitize the suggested name to remove any slashes, just in case the AI ignores the instruction.
    suggestedName = suggestedName.replace(/[\\/]/g, '_');

    const { error: updateError } = await supabaseClient
      .from('case_files_metadata')
      .update({
        file_category: category,
        suggested_name: suggestedName,
      })
      .eq('id', fileId);

    if (updateError) {
      throw new Error(`Failed to update file metadata: ${updateError.message}`);
    }

    return new Response(JSON.stringify({ message: 'File categorized successfully' }), {
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