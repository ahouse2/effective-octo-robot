import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Upload, PlayCircle, Share2, GitGraph, CalendarClock } from "lucide-react";
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
import { Link } from "react-router-dom";

interface CaseToolsProps {
  caseId: string;
}

const MAX_BATCH_FILE_COUNT = 20;
const MAX_BATCH_SIZE_MB = 4; // Supabase Edge Function payload limit is around 4.5MB

export const CaseTools: React.FC<CaseToolsProps> = ({ caseId }) => {
  const [isUploading, setIsUploading] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isGeneratingTimeline, setIsGeneratingTimeline] = useState(false);
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
            toast.error(`Failed to process batch metadata: ${functionError.message}`);
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
      const { data, error } = await supabase.functions.invoke('ai-orchestrator', {
        body: { caseId, command: 're_run_analysis', payload: {} },
      });
      if (error) throw new Error(error.message);
      toast.success("Case analysis initiated successfully! The AI will now begin its work.", { id: loadingToastId });
    } catch (err: any) {
      console.error("Error analyzing case:", err);
      toast.error(err.message || "Failed to start analysis.", { id: loadingToastId });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleExportToNeo4j = async () => {
    setIsExporting(true);
    const loadingToastId = toast.loading("Exporting case data to Neo4j...");
    try {
      const { error } = await supabase.functions.invoke('export-to-neo4j', {
        body: { caseId },
      });
      if (error) throw error;
      toast.success("Case data successfully exported to Neo4j.", { id: loadingToastId });
    } catch (err: any) {
      console.error("Neo4j export error:", err);
      toast.error(err.message || "Failed to export to Neo4j.", { id: loadingToastId });
    } finally {
      setIsExporting(false);
    }
  };

  const handleGenerateTimeline = async () => {
    setIsGeneratingTimeline(true);
    const loadingToastId = toast.loading("Starting automated timeline generation...");
    try {
      const { error } = await supabase.functions.invoke('create-timeline-from-evidence', {
        body: { caseId },
      });
      if (error) throw error;
      toast.success("Timeline generation complete. Check the Case Timeline.", { id: loadingToastId });
    } catch (err: any) {
      console.error("Timeline generation error:", err);
      toast.error(err.message || "Failed to generate timeline.", { id: loadingToastId });
    } finally {
      setIsGeneratingTimeline(false);
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
          <Button onClick={handleGenerateTimeline} disabled={isGeneratingTimeline} className="w-full">
            <CalendarClock className="h-4 w-4 mr-2" />
            {isGeneratingTimeline ? "Generating..." : "Generate Timeline"}
          </Button>
        </div>
      </div>
      <div>
        <Label className="text-base font-medium">Graph Analysis</Label>
        <p className="text-sm text-muted-foreground mb-2">Export data to Neo4j and visualize the relationships.</p>
        <div className="grid grid-cols-2 gap-2">
            <Button onClick={handleExportToNeo4j} disabled={isExporting} variant="secondary">
                <Share2 className="h-4 w-4 mr-2" />
                {isExporting ? "Exporting..." : "Export to Neo4j"}
            </Button>
            <Button asChild variant="secondary">
                <Link to={`/graph-analysis/${caseId}`}>
                    <GitGraph className="h-4 w-4 mr-2" />
                    Visualize Graph
                </Link>
            </Button>
        </div>
      </div>
    </div>
  );
};