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
  const [isUploading, setIsUploading] = useState(false);
  const [isReanalyzing, setIsReanalyzing] = useState(false);
  const { user } = useSession();

  const handleFileChangeAndUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!event.target.files || event.target.files.length === 0) {
      return;
    }
    if (!user) {
      toast.error("You must be logged in to upload files.");
      return;
    }

    const allFiles = Array.from(event.target.files);
    const validFiles = allFiles.filter(file => !file.name.startsWith('~') && !file.name.startsWith('.'));
    const skippedCount = allFiles.length - validFiles.length;

    if (validFiles.length === 0) {
      toast.info(`Skipped ${skippedCount} temporary or system file(s). No valid files selected.`);
      return;
    }

    let toastMessage = `Selected ${validFiles.length} valid files for upload.`;
    if (skippedCount > 0) {
      toastMessage += ` Skipped ${skippedCount} temporary or system file(s).`;
    }
    toast.info(toastMessage);

    setIsUploading(true);
    const loadingToastId = toast.loading(`Uploading ${validFiles.length} files...`);

    try {
      const uploadPromises = validFiles.map(async (file) => {
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

      const uploadedFilePaths = await Promise.all(uploadPromises);
      toast.success(`Successfully uploaded ${uploadedFilePaths.length} files.`);

      const { error: edgeFunctionError } = await supabase.functions.invoke(
        'process-additional-files',
        {
          body: JSON.stringify({
            caseId: caseId,
            newFileNames: uploadedFilePaths,
          }),
        }
      );

      if (edgeFunctionError) throw new Error("Failed to invoke additional file processing function: " + edgeFunctionError.message);

      toast.success("New files submitted for analysis!");
      
    } catch (err: any) {
      console.error("File upload error:", err);
      toast.error(err.message || "An unexpected error occurred during file upload.");
    } finally {
      setIsUploading(false);
      toast.dismiss(loadingToastId);
      // Reset the input value to allow re-uploading the same folder
      event.target.value = '';
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

    } catch (err: any)
{
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
        <Label htmlFor="evidence-folder-upload-tools" className="text-base font-medium">Upload Evidence Folder</Label>
        <p className="text-sm text-muted-foreground mb-2">Click to select a folder. The upload will start immediately.</p>
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
        <Label className="text-base font-medium">Re-run Full Analysis</Label>
        <p className="text-sm text-muted-foreground mb-2">Trigger a complete re-analysis of all evidence in this case.</p>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              disabled={isReanalyzing}
              className="w-full"
              variant="destructive"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              {isReanalyzing ? "Re-analyzing..." : "Re-run Full Analysis"}
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