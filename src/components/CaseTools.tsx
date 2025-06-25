import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Upload, Search, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useSession } from "@/components/SessionContextProvider";
import { EditCaseDetailsDialog } from "./EditCaseDetailsDialog";

interface CaseDetails {
  name: string;
  type: string;
  status: string;
  case_goals: string | null;
  system_instruction: string | null;
  ai_model: "openai" | "gemini";
}

interface CaseToolsProps {
  caseId: string;
  caseDetails: CaseDetails | null;
  onCaseUpdate: () => void;
}

export const CaseTools: React.FC<CaseToolsProps> = ({ caseId, caseDetails, onCaseUpdate }) => {
  const [webSearchQuery, setWebSearchQuery] = useState("");
  const [isSearchingWeb, setIsSearchingWeb] = useState(false);
  const [filesToUpload, setFilesToUpload] = useState<File[]>([]);
  const [isUploadingFiles, setIsUploadingFiles] = useState(false);
  const [isReanalyzing, setIsReanalyzing] = useState(false);
  const { user } = useSession();

  const handleWebSearch = async () => {
    if (!webSearchQuery.trim()) {
      toast.info("Please enter a query for web search.");
      return;
    }
    if (!caseId || !user) {
      toast.error("Case ID or user is missing. Cannot perform web search.");
      return;
    }

    setIsSearchingWeb(true);
    const loadingToastId = toast.loading(`Performing web search for "${webSearchQuery}"...`);

    try {
      const { data, error } = await supabase.functions.invoke(
        'ai-orchestrator',
        {
          body: JSON.stringify({
            caseId: caseId,
            command: 'web_search',
            payload: { query: webSearchQuery },
          }),
        }
      );

      if (error) throw new Error(error.message);

      console.log("Web search initiated response:", data);
      toast.success("Web search initiated successfully! Results will appear in chat.");
      setWebSearchQuery("");

    } catch (err: any) {
      console.error("Error performing web search:", err);
      toast.error(err.message || "Failed to perform web search. Please try again.");
    } finally {
      setIsSearchingWeb(false);
      toast.dismiss(loadingToastId);
    }
  };

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
    const loadingToastId = toast.loading(`Uploading ${filesToUpload.length} files...`);

    try {
      const uploadPromises = filesToUpload.map(async (file) => {
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
      setFilesToUpload([]);

    } catch (err: any) {
      console.error("File upload error:", err);
      toast.error(err.message || "An unexpected error occurred during file upload.");
    } finally {
      setIsUploadingFiles(false);
      toast.dismiss(loadingToastId);
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
        <Label className="text-sm font-medium">Case Directives</Label>
        <div className="flex items-center justify-between mt-1">
          <p className="text-sm text-muted-foreground">View and edit case goals.</p>
          {caseDetails && (
            <EditCaseDetailsDialog
              caseId={caseId}
              initialCaseGoals={caseDetails.case_goals || ""}
              initialSystemInstruction={caseDetails.system_instruction || ""}
              initialAiModel={caseDetails.ai_model}
              onSaveSuccess={onCaseUpdate}
            />
          )}
        </div>
      </div>
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
        <Label htmlFor="web-search-query-tools">Perform Web Search</Label>
        <Input
          id="web-search-query-tools"
          placeholder="e.g., 'California family law updates 2023'"
          value={webSearchQuery}
          onChange={(e) => setWebSearchQuery(e.target.value)}
          disabled={isSearchingWeb}
          className="mt-1"
        />
        <Button
          onClick={handleWebSearch}
          disabled={isSearchingWeb || !webSearchQuery.trim()}
          className="w-full mt-2"
        >
          <Search className="h-4 w-4 mr-2" />
          {isSearchingWeb ? "Searching..." : "Search Web"}
        </Button>
      </div>
      <div>
        <Label>Re-run Full Analysis</Label>
        <Button
          onClick={handleReanalyzeCase}
          disabled={isReanalyzing}
          className="w-full mt-1"
          variant="outline"
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          {isReanalyzing ? "Re-analyzing..." : "Re-run Analysis"}
        </Button>
      </div>
    </div>
  );
};