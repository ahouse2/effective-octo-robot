import React, { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { FileText, Download, Trash } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSession } from "@/components/SessionContextProvider";
import { format } from "date-fns";
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

interface FileMetadata {
  id: string;
  case_id: string;
  file_name: string;
  file_path: string; // Full path in storage bucket (e.g., user_id/case_id/filename.pdf)
  description: string | null;
  tags: string[] | null;
  uploaded_at: string;
  last_modified_at: string;
}

interface CaseFilesDisplayProps {
  caseId: string;
}

export const CaseFilesDisplay: React.FC<CaseFilesDisplayProps> = ({ caseId }) => {
  const [files, setFiles] = useState<FileMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { user } = useSession();

  useEffect(() => {
    if (!caseId || !user) {
      setError("Case ID or user not available to fetch files.");
      setLoading(false);
      return;
    }

    const fetchFilesMetadata = async () => {
      setLoading(true);
      setError(null);
      try {
        const { data, error } = await supabase
          .from('case_files_metadata')
          .select('*')
          .eq('case_id', caseId)
          .order('uploaded_at', { ascending: false });

        if (error) {
          throw error;
        }

        setFiles(data || []);

      } catch (err: any) {
        console.error("Error fetching file metadata:", err);
        setError("Failed to load files metadata. Please ensure RLS policies are correctly configured for 'case_files_metadata'.");
        toast.error("Failed to load case files.");
      } finally {
        setLoading(false);
      }
    };

    fetchFilesMetadata();

    // Real-time subscription for file metadata changes
    const channel = supabase
      .channel(`case_files_metadata_for_case_${caseId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'case_files_metadata', filter: `case_id=eq.${caseId}` },
        (payload) => {
          console.log('File metadata change received!', payload);
          if (payload.eventType === 'INSERT') {
            setFiles((prev) => [payload.new as FileMetadata, ...prev].sort((a, b) => new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime()));
          } else if (payload.eventType === 'UPDATE') {
            setFiles((prev) =>
              prev.map((file) =>
                file.id === payload.old.id ? (payload.new as FileMetadata) : file
              ).sort((a, b) => new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime())
            );
          } else if (payload.eventType === 'DELETE') {
            setFiles((prev) => prev.filter((file) => file.id !== payload.old.id));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [caseId, user]);

  const handleDownload = async (filePath: string, fileName: string) => {
    if (!user) {
      toast.error("You must be logged in to download files.");
      return;
    }
    const loadingToastId = toast.loading(`Downloading ${fileName}...`);

    try {
      const { data, error } = await supabase.storage
        .from('evidence-files')
        .download(filePath);

      if (error) {
        throw error;
      }

      if (data) {
        const url = URL.createObjectURL(data);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast.success(`${fileName} downloaded successfully!`);
      } else {
        throw new Error("No data received for download.");
      }
    } catch (err: any) {
      console.error("Error downloading file:", err);
      toast.error(`Failed to download ${fileName}: ${err.message}`);
    } finally {
      toast.dismiss(loadingToastId);
    }
  };

  const handleDeleteFile = async (fileId: string, filePath: string, fileName: string) => {
    if (!user) {
      toast.error("You must be logged in to delete files.");
      return;
    }

    const loadingToastId = toast.loading(`Deleting ${fileName}...`);

    try {
      // 1. Delete file from Supabase Storage
      const { error: storageError } = await supabase.storage
        .from('evidence-files')
        .remove([filePath]);

      if (storageError) {
        console.error(`Error deleting file ${fileName} from storage:`, storageError);
        throw new Error(`Failed to delete file from storage: ${storageError.message}`);
      }

      // 2. Delete file metadata from the database
      const { error: dbError } = await supabase
        .from('case_files_metadata')
        .delete()
        .eq('id', fileId);

      if (dbError) {
        console.error(`Error deleting file metadata for ${fileName}:`, dbError);
        throw new Error(`Failed to delete file metadata: ${dbError.message}`);
      }

      toast.success(`${fileName} deleted successfully!`);
    } catch (err: any) {
      console.error("File deletion error:", err);
      toast.error(err.message || "An unexpected error occurred during file deletion.");
    } finally {
      toast.dismiss(loadingToastId);
    }
  };

  if (loading) {
    return <div className="text-center py-8">Loading files...</div>;
  }

  if (error) {
    return <div className="text-center py-8 text-red-500">{error}</div>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Uploaded Case Files</CardTitle>
        <CardDescription>All documents uploaded for this case.</CardDescription>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[200px] pr-4">
          {files.length > 0 ? (
            <ul className="space-y-3">
              {files.map((file) => (
                <li key={file.id} className="flex items-start justify-between text-sm">
                  <div className="flex items-start space-x-2">
                    <FileText className="h-4 w-4 flex-shrink-0 mt-1 text-muted-foreground" />
                    <div>
                      <p className="font-medium text-foreground">{file.file_name}</p>
                      {file.description && (
                        <p className="text-xs text-muted-foreground mt-0.5">{file.description}</p>
                      )}
                      {file.tags && file.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {file.tags.map((tag, idx) => (
                            <span key={idx} className="text-xs px-1.5 py-0.5 bg-blue-100 text-blue-800 rounded-full dark:bg-blue-900 dark:text-blue-200">
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                      <p className="text-xs text-muted-foreground mt-1">
                        Uploaded: {format(new Date(file.uploaded_at), "MMM dd, yyyy HH:mm")}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDownload(file.file_path, file.file_name)}
                      className="ml-2 flex-shrink-0"
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-600">
                          <Trash className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This action cannot be undone. This will permanently delete the file
                            <span className="font-bold text-foreground"> "{file.file_name}" </span>
                            from storage and remove its record from this case.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => handleDeleteFile(file.id, file.file_path, file.file_name)}>
                            Delete File
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-center py-4 text-muted-foreground">
              No files uploaded for this case yet.
            </p>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
};