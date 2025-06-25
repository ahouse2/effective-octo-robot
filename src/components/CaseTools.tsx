import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Upload, RefreshCw } from "lucide-react";
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

export const CaseTools: React.FC<CaseToolsProps> = ({ caseId }) => {
  const [filesToUpload, setFilesToUpload] = useState<File[]>([]);
  const [isUploadingFiles, setIsUploadingFiles] = useState(false);
  const [isReanalyzing, setIsReanalyzing] = useState(false);
  const { user } = useSession();

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      const allFiles = Array.from(event.target.files);
      const validFiles = allFiles.filter(file => !file.name.startsWith('~') && !file.name.startsWith('.'));
      const skippedCount = allFiles.length - validFiles.length;

      setFilesToUpload(validFiles);
      
      let toastMessage = `Selected ${validFiles.length} valid files for upload.`;
      if (skippedCount > 0) {
        toastMessage += ` Skipped ${skippedCount} temporary or system file(s).`;
      }
      toast.info(toastMessage);
    }
  };

  const handleUploadFiles = async () => {
    if (!user) {
      toast.error("You must be logged in to upload files.");
      return;
    }
    if (filesToUpload.length === 0) {
      toast.info("Please select files to upload.");
      return;
    }

    setIsUploadingFiles(true);
    const totalFiles = filesToUpload.length;
    const loadingToastId = toast.loading(`Starting upload of ${totalFiles} files...`);
    
    const BATCH_SIZE = 20;
    const allUploadedFilePaths: string[] = [];

    try {
      // Step 1: Upload all files to storage in batches
      for (let i = 0; i < totalFiles; i += BATCH_SIZE) {
        const batch = filesToUpload.slice(i, i + BATCH_SIZE);
        const currentProgress = i + batch.length;
        toast.loading(`Uploading files... (${currentProgress}/${totalFiles})`, { id: loadingToastId });

        const uploadPromises = batch.map(async (file) => {
          const relativePath = (file as any).webkitRelativePath || file.name;
          const filePath = `${user.id}/${caseId}/${relativePath}`;
          const { error: uploadError } = await supabase.storage
            .from('evidence-files')
            .upload(filePath, file, {
              cacheControl: '3600',
              upsert: true,
            });

          if (uploadError) throw new Error(`Failed to upload file ${relativePath}: ${uploadError.message}`);
          return relativePath;
        });

        const uploadedPathsInBatch = await Promise.all(uploadPromises);
        allUploadedFilePaths.push(...uploadedPathsInBatch);
      }

      // Step 2: After all files are uploaded, make a single call to process them
      toast.loading(`All ${totalFiles} files uploaded. Initiating analysis...`, { id: loadingToastId });
      
      const { error: edgeFunctionError } = await supabase.functions.invoke(
        'process-additional-files',
        {
          body: JSON.stringify({
            caseId: caseId,
            newFileNames: allUploadedFilePaths,
          }),
        }
      );

      if (edgeFunctionError) {
        throw new Error(`Failed to start analysis process: ${edgeFunctionError.message}`);
      }

      toast.success(`Successfully uploaded and queued all ${totalFiles} files for analysis.`, { id: loadingToastId });
      setFilesToUpload([]);

    } catch (err: any) {
      console.error("File upload error:", err);
      toast.error(err.message || "An error occurred during upload.", { id: loadingToastId });
    } finally {
      setIsUploadingFiles(false);
      setTimeout(() => toast.dismiss(loadingToastId), 4000);
    }
  };

  const handleReanalyzeCase = async () => {
    if (!user) {
      toast.error("You must be logged in to re-analyze a case.");
      return;
    }

    setIsReanalyzing(true);
    const loadingToastId = toast.loading("Initiating full case re-analysis...");

    try {
      const { data, error } = await supabase.functions.invoke(
        'ai-orchestrator',
        {
          body: JSON.stringify({
            caseId: caseId,
            command: 're_run_analysis',
            payload: {},
          }),
        }
      );

      if (error) throw new Error(error.message);

      console.log("Re-analysis initiated response:", data);
      toast.success("Case re-analysis initiated successfully!");

    } catch (err: any) {
      console.error("Error re-analyzing case:", err);
      toast.error(err.message || "Failed to re-analyze case. Please try again.");
    } finally {
      setIsReanalyzing(false);
      toast.dismiss(loadingToastId);
    }
  };

  return (
    <div className="p-4 space-y-6">
      <div>
        <Label htmlFor="evidence-folder-upload-tools">Upload Evidence Folder</Label>
        <Input
          id="evidence-folder-upload-tools"
          type="file"
          // @ts-ignore
          webkitdirectory=""
          directory=""
          onChange={handleFileChange}
          className="cursor-pointer mt-1"
          disabled={isUploadingFiles}
        />
        <Button
          onClick={handleUploadFiles}
          disabled={isUploadingFiles || filesToUpload.length === 0}
          className="w-full mt-2"
        >
          <Upload className="h-4 w-4 mr-2" />
          {isUploadingFiles ? "Uploading..." : `Upload ${filesToUpload.length} File(s)`}
        </Button>
      </div>
      <div>
        <Label>Re-run Full Analysis</Label>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              disabled={isReanalyzing}
              className="w-full mt-1"
              variant="outline"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              {isReanalyzing ? "Re-analyzing..." : "Re-run Analysis"}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Confirm Re-analysis</AlertDialogTitle>
              <AlertDialogDescription>
                This will trigger a full re-analysis of all evidence in this case. This may incur costs and take some time. Are you sure you want to proceed?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleReanalyzeCase}>
                Confirm & Re-run
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
};