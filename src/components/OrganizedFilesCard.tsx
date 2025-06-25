import React, { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Folder, FileText, Download, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

interface FileMetadata {
  id: string;
  file_name: string;
  file_category: string | null;
  suggested_name: string | null;
}

interface OrganizedFilesCardProps {
  caseId: string;
}

export const OrganizedFilesCard: React.FC<OrganizedFilesCardProps> = ({ caseId }) => {
  const [organizedFiles, setOrganizedFiles] = useState<Record<string, FileMetadata[]>>({});
  const [loading, setLoading] = useState(true);
  const [isDownloading, setIsDownloading] = useState(false);

  const fetchFiles = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('case_files_metadata')
      .select('id, file_name, file_category, suggested_name')
      .eq('case_id', caseId)
      .order('file_category', { ascending: true });

    if (error) {
      toast.error("Failed to load organized files.");
      console.error(error);
    } else {
      const groupedFiles = (data || []).reduce((acc, file) => {
        const category = file.file_category || "Uncategorized";
        if (!acc[category]) {
          acc[category] = [];
        }
        acc[category].push(file);
        return acc;
      }, {} as Record<string, FileMetadata[]>);
      setOrganizedFiles(groupedFiles);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchFiles();
    const channel = supabase
      .channel(`organized_files_for_case_${caseId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'case_files_metadata', filter: `case_id=eq.${caseId}` },
        () => fetchFiles()
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [caseId]);

  const handleDownloadZip = async () => {
    setIsDownloading(true);
    const loadingToastId = toast.loading("Preparing your organized files for download...");

    try {
        const { data, error } = await supabase.functions.invoke('download-organized-zip', {
            body: JSON.stringify({ caseId }),
            responseType: 'blob'
        });

        if (error) throw error;

        const url = URL.createObjectURL(data);
        const a = document.createElement('a');
        a.href = url;
        a.download = `organized_case_${caseId}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast.success("Organized files downloaded successfully!");

    } catch (err: any) {
        console.error("Error downloading zip:", err);
        toast.error(err.message || "Failed to download organized files.");
    } finally {
        setIsDownloading(false);
        toast.dismiss(loadingToastId);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-center">
            <div>
                <CardTitle>Organized Files</CardTitle>
                <CardDescription>AI-categorized and renamed files.</CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={fetchFiles} disabled={loading}>
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p>Loading organized files...</p>
        ) : Object.keys(organizedFiles).length === 0 ? (
          <p>No files have been categorized yet.</p>
        ) : (
          <>
            <ScrollArea className="h-[250px] pr-4">
              <Accordion type="multiple" className="w-full" defaultValue={Object.keys(organizedFiles)}>
                {Object.entries(organizedFiles).map(([category, files]) => (
                  <AccordionItem value={category} key={category}>
                    <AccordionTrigger>
                      <div className="flex items-center">
                        <Folder className="h-4 w-4 mr-2" /> {category} ({files.length})
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <ul className="space-y-2 pl-4">
                        {files.map(file => (
                          <li key={file.id} className="flex items-center text-sm">
                            <FileText className="h-4 w-4 mr-2 flex-shrink-0" />
                            <div>
                                <p className="font-medium">{file.suggested_name || file.file_name}</p>
                                {!file.suggested_name && <p className="text-xs text-yellow-500">Pending categorization...</p>}
                            </div>
                          </li>
                        ))}
                      </ul>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </ScrollArea>
            <Button onClick={handleDownloadZip} disabled={isDownloading || Object.keys(organizedFiles).length === 0} className="w-full mt-4">
              <Download className="h-4 w-4 mr-2" />
              {isDownloading ? "Zipping Files..." : "Download All (Organized)"}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
};