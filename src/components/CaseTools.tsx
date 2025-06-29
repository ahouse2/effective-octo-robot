import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Upload, PlayCircle, Bug, TestTube2, RefreshCw } from "lucide-react";
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

interface CaseToolsProps {
  caseId: string;
}

const MAX_BATCH_FILE_COUNT = 20;
const MAX_BATCH_SIZE_MB = 4; // Supabase Edge Function payload limit is around 4.5MB

export const CaseTools: React.FC<CaseToolsProps> = ({ caseId }) => {
  const [isUploading, setIsUploading] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isDiagnosing, setIsDiagnosing] = useState(false);
  const [isTestingGcp, setIsTestingGcp] = useState(false);
  const [isTestingGemini, setIsTestingGemini] = useState(false);
  const [isReindexing, setIsReindexing] = useState(false);
  const { user } = useSession();

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

  const handleReindex = async () => {
    setIsReindexing(true);
    const loadingToastId = toast.loading("Starting re-indexing process for all files...");
    try {
      const { error } = await supabase.functions.invoke('ai-orchestrator', {
        body: { caseId, command: 're_index_all_files', payload: {} },
      });
      if (error) {
        const detailedError = error.context?.error || error.message;
        throw new Error(detailedError);
      }
      toast.success("Re-indexing process initiated. This may take some time.", { id: loadingToastId });
    } catch (err: any) {
      console.error("Re-indexing error:", err);
      toast.error(err.message || "Failed to start re-indexing.", { id: loadingToastId });
    } finally {
      setIsReindexing(false);
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

  const handleTestGcpConnection = async () => {
    setIsTestingGcp(true);
    const loadingToastId = toast.loading("Testing GCP connection...");
    try {
      const { error } = await supabase.functions.invoke('ai-orchestrator', {
        body: { caseId, command: 'diagnose_gcp_connection', payload: {} },
      });
      if (error) {
        const detailedError = error.context?.error || error.message;
        throw new Error(detailedError);
      }
      toast.success("GCP connection successful! Your secrets are configured correctly.", { id: loadingToastId });
    } catch (err: any) {
      console.error("GCP Connection Test error:", err);
      toast.error(err.message || "Failed to connect to GCP. Check secrets.", { id: loadingToastId });
    } finally {
      setIsTestingGcp(false);
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
        <Label className="text-base font-medium">Troubleshooting</Label>
        <p className="text-sm text-muted-foreground mb-2">Use these tools to diagnose issues with your case setup or cloud connections.</p>
        <div className="space-y-2">
          <Button onClick={handleRunDiagnostics} disabled={isDiagnosing} variant="outline" className="w-full">
            <Bug className="h-4 w-4 mr-2" />
            {isDiagnosing ? "Running..." : "Check Case Settings"}
          </Button>
          <Button onClick={handleTestGcpConnection} disabled={isTestingGcp} variant="outline" className="w-full">
            <TestTube2 className="h-4 w-4 mr-2" />
            {isTestingGcp ? "Testing..." : "Test GCP Connection"}
          </Button>
          <Button onClick={handleTestGeminiConnection} disabled={isTestingGemini} variant="outline" className="w-full">
            <TestTube2 className="h-4 w-4 mr-2" />
            {isTestingGemini ? "Testing..." : "Test Gemini API Key"}
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button disabled={isReindexing} variant="destructive" className="w-full">
                <RefreshCw className="h-4 w-4 mr-2" />
                {isReindexing ? "Re-indexing..." : "Re-index All Files"}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Confirm Re-indexing</AlertDialogTitle>
                <AlertDialogDescription>
                  This will re-process and re-index all files for this case in Vertex AI Search. This is necessary after a system update or to fix search issues. This may incur costs. Are you sure?
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleReindex}>
                  Confirm & Start Re-indexing
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </div>
  );
};