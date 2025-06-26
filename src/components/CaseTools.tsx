import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Upload, PlayCircle } from "lucide-react";
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

const BATCH_SIZE = 20; // Process 20 files at a time

export const CaseTools: React.FC<CaseToolsProps> = ({ caseId }) => {
  const [isUploading, setIsUploading] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
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
    const loadingToastId = toast.loading(`Starting upload of ${allFiles.length} files...`);

    try {
      for (let i = 0; i < allFiles.length; i += BATCH_SIZE) {
        const batch = allFiles.slice(i, i + BATCH_SIZE);
        const progress = `(Files ${i + 1}-${Math.min(i + batch.length, allFiles.length)} of ${allFiles.length})`;
        
        toast.loading(`Uploading batch... ${progress}`, { id: loadingToastId });

        const uploadPromises = batch.map(async (file) => {
          const relativePath = (file as any).webkitRelativePath || file.name;
          const filePath = `${user.id}/${caseId}/${relativePath}`;
          const { error } = await supabase.storage.from('evidence-files').upload(filePath, file, { upsert: true });
          if (error) throw new Error(`Failed to upload ${relativePath}: ${error.message}`);
          return relativePath;
        });
        const uploadedFilePaths = await Promise.all(uploadPromises);

        toast.loading(`Processing batch... ${progress}`, { id: loadingToastId });
        const { error: functionError } = await supabase.functions.invoke('process-additional-files', {
          body: { caseId, newFileNames: uploadedFilePaths },
        });
        if (functionError) throw new Error(`Failed to process batch: ${functionError.message}`);
      }

      toast.success("All files uploaded and processed successfully!", { id: loadingToastId });
      toast.info("You can now run the analysis on all evidence.");

    } catch (err: any) {
      console.error("File upload process error:", err);
      toast.error(err.message || "An unexpected error occurred during upload.", { id: loadingToastId });
    } finally {
      setIsUploading(false);
      event.target.value = ''; // Allow re-uploading the same folder
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

  return (
    <div className="p-4 space-y-6">
      <div>
        <Label htmlFor="evidence-folder-upload-tools" className="text-base font-medium">Step 1: Upload Evidence</Label>
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
        <Label className="text-base font-medium">Step 2: Start Analysis</Label>
        <p className="text-sm text-muted-foreground mb-2">After uploading, trigger the AI to analyze all evidence in this case.</p>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button disabled={isAnalyzing} className="w-full">
              <PlayCircle className="h-4 w-4 mr-2" />
              {isAnalyzing ? "Starting Analysis..." : "Analyze All Evidence"}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Confirm Analysis</AlertDialogTitle>
              <AlertDialogDescription>
                This will start a full analysis of all evidence in this case. This may incur costs and take some time. Are you sure you want to proceed?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleAnalyzeCase}>
                Confirm & Start Analysis
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
};