import React, { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { FileText, Download, FolderOpen } from "lucide-react"; // Added FolderOpen icon
import { Button } from "@/components/ui/button";
import { useSession } from "@/components/SessionContextProvider";
import { EmptyPlaceholder } from "./EmptyPlaceholder"; // Import EmptyPlaceholder

interface CaseFilesDisplayProps {
  caseId: string;
}

interface FileObject {
  name: string;
  id: string;
  created_at: string;
  last_accessed_at: string;
  metadata: {
    size: number;
    mimetype: string;
    [key: string]: any;
  };
  path: string;
  signedUrl?: string; // Optional, if we generate signed URLs
}

export const CaseFilesDisplay: React.FC<CaseFilesDisplayProps> = ({ caseId }) => {
  const [files, setFiles] = useState<FileObject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { user } = useSession();

  useEffect(() => {
    if (!caseId || !user) {
      setError("Case ID or user not available to fetch files.");
      setLoading(false);
      return;
    }

    const fetchFiles = async () => {
      setLoading(true);
      setError(null);
      try {
        const { data, error } = await supabase.storage
          .from('evidence-files')
          .list(`${user.id}/${caseId}/`, {
            limit: 100,
            offset: 0,
            sortBy: { column: 'name', order: 'asc' },
          });

        if (error) {
          throw error;
        }

        // Filter out the directory itself if it appears in the list
        const actualFiles = data?.filter(item => item.name !== '.emptyFolderPlaceholder') || [];
        setFiles(actualFiles as FileObject[]);

      } catch (err: any) {
        console.error("Error fetching files:", err);
        setError("Failed to load files. Please ensure the 'evidence-files' bucket exists and has RLS policies configured for 'select' access by authenticated users.");
        toast.error("Failed to load case files.");
      } finally {
        setLoading(false);
      }
    };

    fetchFiles();

    // Note: Real-time updates for storage buckets are not directly supported by Supabase
    // so new uploads won't appear automatically without re-fetching.
    // For a production app, you might trigger a re-fetch via a database webhook or polling.

  }, [caseId, user]);

  const handleDownload = async (fileName: string) => {
    if (!user) {
      toast.error("You must be logged in to download files.");
      return;
    }
    const filePath = `${user.id}/${caseId}/${fileName}`;
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
            <ul className="space-y-2">
              {files.map((file) => (
                <li key={file.id} className="flex items-center justify-between text-sm text-muted-foreground">
                  <div className="flex items-center space-x-2">
                    <FileText className="h-4 w-4 flex-shrink-0" />
                    <span>{file.name}</span>
                    {file.metadata?.size && (
                      <span className="text-xs text-gray-500">({(file.metadata.size / 1024 / 1024).toFixed(2)} MB)</span>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDownload(file.name)}
                    className="ml-2"
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyPlaceholder
              icon={FolderOpen}
              title="No Files Uploaded"
              description="Upload evidence files to begin analysis for this case."
            />
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
};