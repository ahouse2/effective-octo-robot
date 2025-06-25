import React, { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Folder, FileText, Download, Trash, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
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
import { EditFileMetadataDialog } from "./EditFileMetadataDialog";

interface FileMetadata {
  id: string;
  case_id: string;
  file_name: string;
  file_path: string;
  description: string | null;
  tags: string[] | null;
  uploaded_at: string;
  file_category: string | null;
  suggested_name: string | null;
}

interface EvidenceManagerProps {
  caseId: string;
}

export const EvidenceManager: React.FC<EvidenceManagerProps> = ({ caseId }) => {
  const [files, setFiles] = useState<FileMetadata[]>([]);
  const [groupedFiles, setGroupedFiles] = useState<Record<string, FileMetadata[]>>({});
  const [loading, setLoading] = useState(true);
  const [isDownloading, setIsDownloading] = useState<Record<string, boolean>>({});
  const { user } = useSession();

  const fetchFiles = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('case_files_metadata')
      .select('*')
      .eq('case_id', caseId)
      .order('file_category', { ascending: true, nullsFirst: false })
      .order('suggested_name', { ascending: true });

    if (error) {
      toast.error("Failed to load evidence files.");
      console.error(error);
    } else {
      setFiles(data || []);
      const grouped = (data || []).reduce((acc, file) => {
        const category = file.file_category || "Uncategorized";
        if (!acc[category]) acc[category] = [];
        acc[category].push(file);
        return acc;
      }, {} as Record<string, FileMetadata[]>);
      setGroupedFiles(grouped);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (caseId && user) {
      fetchFiles();
      const channel = supabase
        .channel(`evidence_manager_for_case_${caseId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'case_files_metadata', filter: `case_id=eq.${caseId}` },
          () => fetchFiles()
        )
        .subscribe();
      return () => { supabase.removeChannel(channel); };
    }
  }, [caseId, user]);

  const handleDownloadZip = async (category?: string) => {
    const downloadKey = category || 'all';
    setIsDownloading(prev => ({ ...prev, [downloadKey]: true }));
    const loadingToastId = toast.loading(category ? `Zipping category: ${category}...` : "Zipping all organized files...");

    try {
      const { data, error } = await supabase.functions.invoke('download-organized-zip', {
        body: JSON.stringify({ caseId, category }),
        responseType: 'blob'
      });

      if (error) throw error;

      const fileName = category 
        ? `case_${caseId}_${category.replace(/\s+/g, '_')}.zip`
        : `organized_case_${caseId}.zip`;

      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("Download started successfully!");

    } catch (err: any) {
      console.error("Error downloading zip:", err);
      toast.error(err.message || "Failed to download zip.");
    } finally {
      setIsDownloading(prev => ({ ...prev, [downloadKey]: false }));
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
      // First, delete the file from storage
      const { error: storageError } = await supabase.storage.from('evidence-files').remove([filePath]);
      if (storageError) {
        // If the file doesn't exist in storage, we can still proceed to delete the metadata
        if (storageError.message !== 'The resource was not found') {
          throw storageError;
        }
      }
      
      // Then, delete the metadata record
      const { error: dbError } = await supabase.from('case_files_metadata').delete().eq('id', fileId);
      if (dbError) throw dbError;

      toast.success(`${fileName} deleted successfully!`);
    } catch (err: any) {
      console.error("File deletion error:", err);
      toast.error(err.message || "An unexpected error occurred during file deletion.");
    } finally {
      toast.dismiss(loadingToastId);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-center">
          <div>
            <CardTitle>Evidence Manager</CardTitle>
            <CardDescription>AI-categorized files with summaries and tags.</CardDescription>
          </div>
          <div className="flex items-center space-x-2">
            <Button variant="ghost" size="icon" onClick={fetchFiles} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
            <Button onClick={() => handleDownloadZip()} disabled={isDownloading['all'] || files.length === 0}>
              <Download className="h-4 w-4 mr-2" />
              {isDownloading['all'] ? "Zipping..." : "Download All"}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-center py-4">Loading evidence...</p>
        ) : Object.keys(groupedFiles).length === 0 ? (
          <p className="text-center py-4">No evidence files have been uploaded or categorized yet.</p>
        ) : (
          <ScrollArea className="h-[400px] pr-4">
            <Accordion type="multiple" className="w-full" defaultValue={Object.keys(groupedFiles)}>
              {Object.entries(groupedFiles).map(([category, filesInCategory]) => (
                <AccordionItem value={category} key={category}>
                  <AccordionTrigger>
                    <div className="flex justify-between items-center w-full pr-2">
                      <div className="flex items-center">
                        <Folder className="h-4 w-4 mr-2" /> {category} ({filesInCategory.length})
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => { e.stopPropagation(); handleDownloadZip(category); }}
                        disabled={isDownloading[category]}
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <ul className="space-y-3 pl-4">
                      {filesInCategory.map(file => (
                        <li key={file.id} className="flex items-start justify-between text-sm">
                          <div className="flex items-start space-x-2">
                            <FileText className="h-4 w-4 flex-shrink-0 mt-1 text-muted-foreground" />
                            <div className="flex-1">
                              <p className="font-medium text-foreground">{file.suggested_name || file.file_name}</p>
                              {file.description && <p className="text-xs text-muted-foreground mt-0.5 italic">"{file.description}"</p>}
                              {file.tags && file.tags.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {file.tags.map((tag, idx) => (
                                    <span key={idx} className="text-xs px-1.5 py-0.5 bg-blue-100 text-blue-800 rounded-full dark:bg-blue-900 dark:text-blue-200">{tag}</span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center space-x-1">
                            <EditFileMetadataDialog file={file} />
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-600">
                                  <Trash className="h-4 w-4" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    This will permanently delete "{file.file_name}". This action cannot be undone.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => handleDeleteFile(file.id, file.file_path, file.file_name)}>
                                    Delete
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
};