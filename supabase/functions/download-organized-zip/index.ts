import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.1'; // Updated version
import * as fflate from 'https://esm.sh/fflate@0.8.2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { caseId, category } = await req.json();
    if (!caseId) throw new Error("Case ID is required.");

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    );

    let query = supabaseClient
      .from('case_files_metadata')
      .select('file_path, file_category, suggested_name, file_name')
      .eq('case_id', caseId)
      .not('suggested_name', 'is', null);

    if (category) {
      query = query.eq('file_category', category);
    }

    const { data: files, error: filesError } = await query;

    if (filesError) throw filesError;
    if (!files || files.length === 0) {
      const errorMessage = category ? `No categorized files found in category "${category}".` : "No categorized files found to zip.";
      throw new Error(errorMessage);
    }

    const zipObject: fflate.Zippable = {};

    await Promise.all(files.map(async (file) => {
      const { data: blob, error: downloadError } = await supabaseClient.storage
        .from('evidence-files')
        .download(file.file_path);
      
      if (downloadError) {
        console.error(`Failed to download ${file.file_path}:`, downloadError);
        return;
      }

      const buffer = await blob.arrayBuffer();
      const fileNameInZip = file.suggested_name || file.file_name;
      const zipPath = category ? fileNameInZip : `${file.file_category || 'Uncategorized'}/${fileNameInZip}`;
      zipObject[zipPath] = new Uint8Array(buffer);
    }));

    const zipData = fflate.zipSync(zipObject);
    
    const zipFileName = category 
      ? `case_${caseId}_${category.replace(/\s+/g, '_')}.zip`
      : `organized_case_${caseId}.zip`;

    return new Response(zipData, {
      headers: { 
        ...corsHeaders, 
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${zipFileName}"`
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