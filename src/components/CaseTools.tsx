import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Upload, PlayCircle, Bug, TestTube2, RefreshCw, Clock, Share2, BrainCircuit } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useSession } from "@/components/SessionContextProvider";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Link, useNavigate } from "react-router-dom"; // Import useNavigate
import { Textarea } from "./ui/textarea";

interface CaseToolsProps {
  caseId: string;
}

const MAX_BATCH_FILE_COUNT = 20;
const MAX_BATCH_SIZE_MB = 4;

export const CaseTools: React.FC<CaseToolsProps> = ({ caseId }) => {
  const [isUploading, setIsUploading] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isDiagnosing, setIsDiagnosing] = useState(false);
  const [isTestingGemini, setIsTestingGemini] = useState(false);
  const [isResummarizing, setIsResummarizing] = useState(false);
  const [isGeneratingTimeline, setIsGeneratingTimeline] = useState(false);
  const [isExportingToGraph, setIsExportingToGraph] = useState(false);
  const [isAnalyzingGraph, setIsAnalyzingGraph] = useState(false);
  const [timelineFocus, setTimelineFocus] = useState("");
  const { user } = useSession();
  const navigate = useNavigate(); // Initialize useNavigate

  const handleFileChangeAndUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!event.target.files || event.target.files.length === 0) return;
    if (!user) {
      toast.error("You must be logged in to upload files.");
      return;
    }

    const allFiles = Array.from(event.target.files).filter(file => !file.name.startsWith('~') && !file.name.startsWith('.'));
    if (allFiles.length === 0) {
      toast.info("No valid files selected for upload.");
      return;
    }

    setIsUploading(true);
    const loadingToastId = toast.loading(`Preparing to upload ${allFiles.length} files...`);

    try {
      const batches: File[][] = [];
      let currentBatch: File[] = [];
      let currentBatchSize = 0;

      for (const file of allFiles) {
        if (
          currentBatch.length >= MAX_BATCH_FILE_COUNT ||
          (currentBatchSize + file.size) > (MAX_BATCH_SIZE_MB * 1024 * 1024)
        ) {
          batches.push(currentBatch);
          currentBatch = [];
          currentBatchSize = 0;
        }
        currentBatch.push(file);
        currentBatchSize += file.size;
      }
      if (currentBatch.length > 0) {
        batches.push(currentBatch);
      }

      toast.info(`Uploading ${allFiles.length} files in ${batches.length} batches.`);
      let totalSuccessfulUploads = 0;

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const progress = `(Batch ${i + 1} of ${batches.length})`;
        
        toast.loading(`Uploading batch... ${progress}`, { id: loadingToastId });

        const uploadPromises = batch.map(async (file) => {
          const relativePath = ((file as any).webkitRelativePath || file.name).replace(/\//g, '_');
          const filePath = `${user.id}/${caseId}/${relativePath}`;
          const { error } = await supabase.storage.from('evidence-files').upload(filePath, file, { upsert: true });
          if (error) {
            throw new Error(`Failed to upload ${file.name}: ${error.message}`);
          }
          return relativePath;
        });

        const results = await Promise.allSettled(uploadPromises);
        const successfulUploads = results
          .filter(r => r.status === 'fulfilled')
          .map(r => (r as PromiseFulfilledResult<string>).value);
        
        results.forEach(r => {
          if (r.status === 'rejected') {
            console.error("Upload failed for a file:", r.reason);
            toast.error(r.reason.message);
          }
        });

        if (successfulUploads.length > 0) {
          totalSuccessfulUploads += successfulUploads.length;
          toast.loading(`Processing ${successfulUploads.length} successful uploads... ${progress}`, { id: loadingToastId });
          const { error: functionError } = await supabase.functions.invoke('process-additional-files', {
            body: { caseId, newFileNames: successfulUploads },
          });
          if (functionError) {
            const detailedError = functionError.context?.error || functionError.message;
            toast.error(`Failed to process batch metadata: ${detailedError}`);
          }
        }
      }

      if (totalSuccessfulUploads > 0) {
        toast.success(`Upload complete. ${totalSuccessfulUploads} files processed.`, { id: loadingToastId });
        toast.info("You can now run the analysis on all evidence.");
      } else {
        toast.error("Upload failed. No files were successfully processed.", { id: loadingToastId });
      }

    } catch (err: any) {
      console.error("File upload process error:", err);
      toast.error(err.message || "An unexpected error occurred during upload.", { id: loadingToastId });
    } finally {
      setIsUploading(false);
      event.target.value = '';
    }
  };

  const handleAnalyzeCase = async () => {
    if (!user) {
      toast.error("You must be logged in to analyze a case.");
      return;
    }

    setIsAnalyzing(true);
    const loadingToastId = toast.loading("Initiating full case analysis...");

    try {
      const { error } = await supabase.functions.invoke('ai-orchestrator', {
        body: { caseId, command: 're_run_analysis', payload: {} },
      });
      if (error) {
        const detailedError = error.context?.error || error.message;
        throw new Error(detailedError);
      }
      toast.success("Case analysis initiated successfully! The AI will now begin its work.", { id: loadingToastId });
    } catch (err: any) {
      console.error("Error analyzing case:", err);
      toast.error(err.message || "Failed to start analysis.", { id: loadingToastId });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleGenerateTimeline = async () => {
    setIsGeneratingTimeline(true);
    const loadingToastId = toast.loading(timelineFocus ? `Generating timeline for "${timelineFocus}"...` : "Generating general timeline...");
    try {
      const { error } = await supabase.functions.invoke('create-timeline-from-evidence', {
        body: { caseId, focus: timelineFocus || null },
      });
      if (error) {
        const detailedError = error.context?.error || error.message;
        throw new Error(detailedError);
      }
      toast.success("Timeline generation complete! Check the Case Details page.", { id: loadingToastId });
      setTimelineFocus("");
    } catch (err: any) {
      console.error("Timeline generation error:", err);
      toast.error(err.message || "Failed to generate timeline.", { id: loadingToastId });
    } finally {
      setIsGeneratingTimeline(false);
    }
  };

  const handleExportToGraph = async () => {
    setIsExportingToGraph(true);
    const loadingToastId = toast.loading("Exporting case data to Neo4j Graph DB...");
    try {
      const { error } = await supabase.functions.invoke('export-to-neo4j', {
        body: { caseId },
      });
      if (error) {
        const detailedError = error.context?.error || error.message;
        throw new Error(detailedError);
      }
      toast.success("Case data successfully exported to Graph DB. Redirecting to graph view...", { id: loadingToastId });
      navigate(`/graph-analysis/${caseId}`); // Navigate to the graph analysis page
    } catch (err: any) {
      console.error("Graph export error:", err);
      toast.error(err.message || "Failed to export to Graph DB.", { id: loadingToastId });
    } finally {
      setIsExportingToGraph(false);
    }
  };

  const handleAnalyzeGraph = async () => {
    setIsAnalyzingGraph(true);
    const loadingToastId = toast.loading("Sending graph data to AI for analysis...");
    try {
      const { error } = await supabase.functions.invoke('get-neo4j-graph-for-ai', {
        body: { caseId },
      });
      if (error) {
        const detailedError = error.context?.error || error.message;
        throw new Error(detailedError);
      }
      toast.success("Graph analysis initiated. Check the chat for results.", { id: loadingToastId });
    } catch (err: any) {
      console.error("Graph analysis error:", err);
      toast.error(err.message || "Failed to start graph analysis.", { id: loadingToastId });
    } finally {
      setIsAnalyzingGraph(false);
    }
  };

  const handleResummarize = async () => {
    setIsResummarizing(true);
    const loadingToastId = toast.loading("Starting re-summarization for all files...");
    try {
      let allFiles: any[] = [];
      let hasMore = true;
      let page = 0;
      const pageSize = 1000; // Supabase default limit

      toast.info("Fetching file list...", { id: loadingToastId });

      while (hasMore) {
        const from = page * pageSize;
        const to = from + pageSize - 1;
        
        const { data: files, error: filesError } = await supabase
          .from('case_files_metadata')
          .select('id, file_path, case_id')
          .eq('case_id', caseId)
          .range(from, to);

        if (filesError) throw filesError;

        if (files && files.length > 0) {
          allFiles = allFiles.concat(files);
        }

        if (!files || files.length < pageSize) {
          hasMore = false;
        } else {
          page++;
        }
      }

      if (allFiles.length === 0) {
        toast.info("No files found in this case to re-summarize.", { id: loadingToastId });
        setIsResummarizing(false);
        return;
      }

      toast.info(`Found ${allFiles.length} files. Submitting to summarizer agent... This may take a while.`, { id: loadingToastId });

      const batchSize = 10; // Invoke 10 functions at a time
      for (let i = 0; i < allFiles.length; i += batchSize) {
          const batch = allFiles.slice(i, i + batchSize);
          const currentBatchNum = i / batchSize + 1;
          const totalBatches = Math.ceil(allFiles.length / batchSize);
          toast.info(`Processing batch ${currentBatchNum} of ${totalBatches}...`, { id: loadingToastId });
          
          const promises = batch.map(file => 
              supabase.functions.invoke('summarize-file', {
                  body: { filePath: file.file_path, fileId: file.id, caseId: file.case_id },
              })
          );
          await Promise.all(promises);
      }

      toast.success(`Successfully submitted all ${allFiles.length} files for re-summarization.`, { id: loadingToastId });
    } catch (err: any) {
      console.error("Re-summarization error:", err);
      toast.error(err.message || "Failed to start re-summarization.", { id: loadingToastId });
    } finally {
      setIsResummarizing(false);
    }
  };

  const handleRunDiagnostics = async () => {
    setIsDiagnosing(true);
    const loadingToastId = toast.loading("Running diagnostics...");
    try {
      const { error } = await supabase.functions.invoke('ai-orchestrator', {
        body: { caseId, command: 'diagnose_case_settings', payload: {} },
      });
      if (error) {
        const detailedError = error.context?.error || error.message;
        throw new Error(detailedError);
      }
      toast.success("Diagnostics complete. Please check the 'Log' tab for the settings report.", { id: loadingToastId });
    } catch (err: any) {
      console.error("Diagnostics error:", err);
      toast.error(err.message || "Failed to run diagnostics.", { id: loadingToastId });
    } finally {
      setIsDiagnosing(false);
    }
  };

  const handleTestGeminiConnection = async () => {
    setIsTestingGemini(true);
    const loadingToastId = toast.loading("Testing Gemini API connection...");
    try {
      const { error } = await supabase.functions.invoke('ai-orchestrator', {
        body: { caseId, command: 'diagnose_gemini_connection', payload: {} },
      });
      if (error) {
        const detailedError = error.context?.error || error.message;
        throw new Error(detailedError);
      }
      toast.success("Gemini API connection successful! Your key is valid.", { id: loadingToastId });
    } catch (err: any) {
      console.error("Gemini Connection Test error:", err);
      toast.error(err.message || "Failed to connect to Gemini. Check secrets.", { id: loadingToastId });
    } finally {
      setIsTestingGemini(false);
    }
  };

  return (
    <div className="p-4 space-y-6">
      <div>
        <Label htmlFor="evidence-folder-upload-tools" className="text-base font-medium">Upload Evidence</Label>
        <p className="text-sm text-muted-foreground mb-2">Upload a folder of evidence. Files will be processed in batches.</p>
        <Button asChild className="w-full cursor-pointer" variant="outline" disabled={isUploading}>
          <label htmlFor="evidence-folder-upload-tools">
            <Upload className="h-4 w-4 mr-2" />
            {isUploading ? "Uploading..." : "Select Folder to Upload"}
            <Input
              id="evidence-folder-upload-tools"
              type="file"
              // @ts-ignore
              webkitdirectory=""
              directory=""
              onChange={handleFileChangeAndUpload}
              className="hidden"
              disabled={isUploading}
            />
          </label>
        </Button>
      </div>
      <div>
        <Label className="text-base font-medium">AI Analysis Tools</Label>
        <p className="text-sm text-muted-foreground mb-2">Trigger different AI agents to process the case data.</p>
        <div className="space-y-2">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button disabled={isAnalyzing} className="w-full">
                <PlayCircle className="h-4 w-4 mr-2" />
                {isAnalyzing ? "Starting Analysis..." : "Run Full Analysis"}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Confirm Full Analysis</AlertDialogTitle>
                <AlertDialogDescription>
                  This will start a comprehensive analysis of all evidence. This may incur costs and take time. Are you sure?
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleAnalyzeCase}>
                  Confirm & Start
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
      <div>
        <Label className="text-base font-medium">Data & Export Tools</Label>
        <p className="text-sm text-muted-foreground mb-2">Generate new data representations or export them.</p>
        <div className="space-y-2">
          <div className="space-y-2 rounded-md border p-4">
            <Label htmlFor="timeline-focus">Focused Timeline Generation</Label>
            <Textarea
              id="timeline-focus"
              placeholder="Optional: Enter a fact pattern or legal argument to focus on..."
              value={timelineFocus}
              onChange={(e) => setTimelineFocus(e.target.value)}
              className="min-h-[60px]"
            />
            <Button onClick={handleGenerateTimeline} disabled={isGeneratingTimeline} className="w-full" variant="secondary">
              <Clock className="h-4 w-4 mr-2" />
              {isGeneratingTimeline ? "Generating..." : "Generate Timeline"}
            </Button>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button disabled={isExportingToGraph} className="w-full" variant="secondary">
                <Share2 className="h-4 w-4 mr-2" />
                {isExportingToGraph ? "Exporting..." : "Export to Graph DB"}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Confirm Graph Database Export</AlertDialogTitle>
                <AlertDialogDescription>
                  This will export the current case data (files, insights, etc.) to your Neo4j AuraDB instance. This will overwrite any existing graph data for this case.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleExportToGraph}>
                  Confirm & Export
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button disabled={isAnalyzingGraph} className="w-full" variant="secondary">
                <BrainCircuit className="h-4 w-4 mr-2" />
                {isAnalyzingGraph ? "Analyzing..." : "Analyze Graph with AI"}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Confirm Graph Analysis with AI</AlertDialogTitle>
                <AlertDialogDescription>
                  This will fetch the current graph data from Neo4j and send it to the AI for analysis. The results will appear in the chat. This may incur costs.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleAnalyzeGraph}>
                  Confirm & Analyze
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Button asChild className="w-full" variant="outline">
            <Link to={`/graph-analysis/${caseId}`}>
              <Share2 className="h-4 w-4 mr-2" />
              View Graph Analysis
            </Link>
          </Button>
        </div>
      </div>
      <div>
        <Label className="text-base font-medium">Troubleshooting</Label>
        <p className="text-sm text-muted-foreground mb-2">Use these tools to diagnose issues with your case setup or cloud connections.</p>
        <div className="space-y-2">
          <Button onClick={handleRunDiagnostics} disabled={isDiagnosing} variant="outline" className="w-full">
            <Bug className="h-4 w-4 mr-2" />
            {isDiagnosing ? "Running..." : "Check Case Settings"}
          </Button>
          <Button onClick={handleTestGeminiConnection} disabled={isTestingGemini} variant="outline" className="w-full">
            <TestTube2 className="h-4 w-4 mr-2" />
            {isTestingGemini ? "Testing..." : "Test Gemini API Key"}
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button disabled={isResummarizing} variant="destructive" className="w-full">
                <RefreshCw className="h-4 w-4 mr-2" />
                {isResummarizing ? "Re-summarizing..." : "Re-summarize All Files"}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Confirm Re-summarization</AlertDialogTitle>
                <AlertDialogDescription>
                  This will re-process and re-summarize all files for this case. This is necessary if summaries are missing or need to be updated. This may incur costs. Are you sure?
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleResummarize}>
                  Confirm & Start Re-summarizing
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </div>
  );
};