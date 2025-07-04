import React, { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Folder, FileText, Download, Trash, RefreshCw, LayoutGrid, ListTree, Search, X } from "lucide-react";
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { DocumentViewer } from "./DocumentViewer";
import { Input } from "@/components/ui/input";
import { debounce } from "lodash";
import { downloadBlob } from "@/lib/download";

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
  file_hash: string | null;
  hash_algorithm: string | null;
}

interface SearchResult extends FileMetadata {
  snippets: string[];
}

interface EvidenceManagerProps {
  caseId: string;
}

const FolderTreeView = ({ node, level = 0, handleDeleteFile, handleFileClick }: { node: any, level?: number, handleDeleteFile: (fileId: string, filePath: string, fileName: string) => void, handleFileClick: (file: FileMetadata) => void }) => {
  return (
    <ul className={level > 0 ? "pl-4" : ""}>
      {Object.keys(node).filter(key => key !== '_files').sort().map(folderName => (
        <li key={folderName}>
          <div className="flex items-center py-1 text-sm">
            <Folder className="h-4 w-4 mr-2 flex-shrink-0 text-yellow-500" />
            <span className="font-medium">{folderName}</span>
          </div>
          <FolderTreeView node={node[folderName]} level={level + 1} handleDeleteFile={handleDeleteFile} handleFileClick={handleFileClick} />
        </li>
      ))}
      {node._files?.sort((a: FileMetadata, b: FileMetadata) => a.file_name.localeCompare(b.file_name)).map((file: FileMetadata) => (
        <li key={file.id} className="flex items-start justify-between text-sm py-1.5 hover:bg-accent rounded-md px-2 -mx-2 group">
          <div className="flex items-start space-x-2 overflow-hidden">
            <FileText className="h-4 w-4 flex-shrink-0 mt-1 text-muted-foreground" />
            <div className="flex-1 overflow-hidden">
              <p className="font-medium text-foreground truncate cursor-pointer hover:underline" title={file.suggested_name || file.file_name} onClick={() => handleFileClick(file)}>{file.suggested_name || file.file_name}</p>
              {file.description && <p className="text-xs text-muted-foreground mt-0.5 italic truncate">"{file.description}"</p>}
              {file.tags && file.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {file.tags.map((tag, idx) => (
                    <span key={idx} className="text-xs px-1.5 py-0.5 bg-blue-100 text-blue-800 rounded-full dark:bg-blue-900 dark:text-blue-200">{tag}</span>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
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
  );
};

export const EvidenceManager: React.FC<EvidenceManagerProps> = ({ caseId }) => {
  const [allFiles, setAllFiles] = useState<FileMetadata[]>([]);
  const [groupedFiles, setGroupedFiles] = useState<Record<string, FileMetadata[]>>({});
  const [folderStructure, setFolderStructure] = useState<any>({});
  const [viewMode, setViewMode] = useState<'category' | 'folder'>('category');
  const [loading, setLoading] = useState(true);
  const [isDownloading, setIsDownloading] = useState<Record<string, boolean>>({});
  const { user } = useSession();
  const [isViewerOpen, setIsViewerOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<FileMetadata | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  const fetchFiles = async () => {
    setLoading(true);
    let fetchedFiles: FileMetadata[] = [];
    let hasMore = true;
    let page = 0;
    const pageSize = 1000;

    while(hasMore) {
      const from = page * pageSize;
      const to = from + pageSize - 1;
      const { data, error } = await supabase
        .from('case_files_metadata')
        .select('*')
        .eq('case_id', caseId)
        .order('file_category', { ascending: true, nullsFirst: false })
        .order('suggested_name', { ascending: true })
        .range(from, to);

      if (error) {
        toast.error("Failed to load evidence files.");
        console.error(error);
        hasMore = false;
      } else {
        fetchedFiles = [...fetchedFiles, ...data];
        if (data.length < pageSize) {
          hasMore = false;
        } else {
          page++;
        }
      }
    }

    setAllFiles(fetchedFiles);

    const groupedByCategory = fetchedFiles.reduce((acc, file) => {
      const category = file.file_category || "Uncategorized";
      if (!acc[category]) acc[category] = [];
      acc[category].push(file);
      return acc;
    }, {} as Record<string, FileMetadata[]>);
    setGroupedFiles(groupedByCategory);

    const root: any = {};
    fetchedFiles.forEach(file => {
      const pathParts = file.file_path.split('/').slice(2);
      let currentLevel = root;
      pathParts.forEach((part, index) => {
        if (index === pathParts.length - 1) {
          if (!currentLevel._files) currentLevel._files = [];
          currentLevel._files.push(file);
        } else {
          if (!currentLevel[part]) currentLevel[part] = {};
          currentLevel = currentLevel[part];
        }
      });
    });
    setFolderStructure(root);
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

  const handleSearch = async (query: string) => {
    if (!query) {
      setSearchResults(null);
      return;
    }
    setIsSearching(true);
    try {
      const { data, error } = await supabase.functions.invoke('ai-orchestrator', {
        body: { caseId, command: 'search_evidence', payload: { query } },
      });
      if (error) throw error;
      if (data.error) throw new Error(data.error);

      const enrichedResults: SearchResult[] = (data.results || []).map((result: { id: string; snippets: string[] }) => {
        const fileInfo = allFiles.find(f => f.id === result.id);
        if (fileInfo) {
            return {
                ...fileInfo,
                snippets: result.snippets,
            } as SearchResult;
        }
        return null;
      }).filter(Boolean) as SearchResult[];

      setSearchResults(enrichedResults);
    } catch (err: any) {
      toast.error(err.message || "Failed to perform search.");
    } finally {
      setIsSearching(false);
    }
  };

  const debouncedSearch = useCallback(debounce(handleSearch, 300), [allFiles]);

  useEffect(() => {
    debouncedSearch(searchQuery);
    return () => debouncedSearch.cancel();
  }, [searchQuery, debouncedSearch]);

  const handleDownloadZip = async (category?: string) => {
    const downloadKey = category || 'all';
    setIsDownloading(prev => ({ ...prev, [downloadKey]: true }));
    const loadingToastId = toast.loading(category ? `Zipping category: ${category}...` : "Zipping all organized files...");

    try {
      const { data, error } = await supabase.functions.invoke('download-organized-zip', {
        body: JSON.stringify({ caseId, category }),
      });

      if (error) throw error;

      const fileName = category 
        ? `case_${caseId}_${category.replace(/\s+/g, '_')}.zip`
        : `organized_case_${caseId}.zip`;

      downloadBlob(data, fileName);

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
      const { error: storageError } = await supabase.storage.from('evidence-files').remove([filePath]);
      if (storageError && storageError.message !== 'The resource was not found') {
        throw storageError;
      }
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

  const handleFileClick = (file: FileMetadata) => {
    setSelectedFile(file);
    setIsViewerOpen(true);
  };

  const renderSearchResults = () => (
    <div className="space-y-4">
      {isSearching ? (
        <p className="text-center py-4">Searching...</p>
      ) : searchResults && searchResults.length > 0 ? (
        searchResults.map(file => (
          <div key={file.id} className="p-3 border rounded-lg">
            <p className="font-semibold text-primary cursor-pointer hover:underline" onClick={() => handleFileClick(file)}>{file.suggested_name || file.file_name}</p>
            <div className="mt-2 space-y-1">
              {file.snippets.map((snippet, i) => (
                <p key={i} className="text-sm text-muted-foreground border-l-2 pl-2" dangerouslySetInnerHTML={{ __html: snippet }} />
              ))}
            </div>
          </div>
        ))
      ) : (
        <p className="text-center py-4">No results found for "{searchQuery}".</p>
      )}
    </div>
  );

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <div>
              <CardTitle>Evidence Manager</CardTitle>
              <CardDescription>View, search, and manage your case files.</CardDescription>
            </div>
            <div className="flex items-center space-x-2">
              <ToggleGroup type="single" value={viewMode} onValueChange={(value) => { if (value) setViewMode(value as 'category' | 'folder') }} className="mr-2">
                <ToggleGroupItem value="category" aria-label="Category view">
                  <LayoutGrid className="h-4 w-4" />
                </ToggleGroupItem>
                <ToggleGroupItem value="folder" aria-label="Folder view">
                  <ListTree className="h-4 w-4" />
                </ToggleGroupItem>
              </ToggleGroup>
              <Button variant="ghost" size="icon" onClick={fetchFiles} disabled={loading}>
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              </Button>
              <Button onClick={() => handleDownloadZip()} disabled={isDownloading['all'] || allFiles.length === 0}>
                <Download className="h-4 w-4 mr-2" />
                {isDownloading['all'] ? "Zipping..." : "Download All"}
              </Button>
            </div>
          </div>
          <div className="relative mt-4">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search within evidence files..."
              className="w-full pl-8"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <Button variant="ghost" size="icon" className="absolute right-1 top-1 h-7 w-7" onClick={() => setSearchQuery("")}>
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-center py-4">Loading evidence...</p>
          ) : searchResults ? (
            renderSearchResults()
          ) : allFiles.length === 0 ? (
            <p className="text-center py-4">No evidence files have been uploaded or categorized yet.</p>
          ) : (
            <ScrollArea className="h-[400px] pr-4">
              {viewMode === 'category' ? (
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
                            <li key={file.id} className="flex items-start justify-between text-sm group">
                              <div className="flex items-start space-x-2 overflow-hidden">
                                <FileText className="h-4 w-4 flex-shrink-0 mt-1 text-muted-foreground" />
                                <div className="flex-1 overflow-hidden">
                                  <p className="font-medium text-foreground truncate cursor-pointer hover:underline" title={file.suggested_name || file.file_name} onClick={() => handleFileClick(file)}>{file.suggested_name || file.file_name}</p>
                                  {file.description && <p className="text-xs text-muted-foreground mt-0.5 italic truncate">"{file.description}"</p>}
                                  {file.tags && file.tags.length > 0 && (
                                    <div className="flex flex-wrap gap-1 mt-1">
                                      {file.tags.map((tag, idx) => (
                                        <span key={idx} className="text-xs px-1.5 py-0.5 bg-blue-100 text-blue-800 rounded-full dark:bg-blue-900 dark:text-blue-200">{tag}</span>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
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
              ) : (
                <FolderTreeView node={folderStructure} handleDeleteFile={handleDeleteFile} handleFileClick={handleFileClick} />
              )}
            </ScrollArea>
          )}
        </CardContent>
      </Card>
      <DocumentViewer
        file={selectedFile}
        isOpen={isViewerOpen}
        onOpenChange={setIsViewerOpen}
      />
    </>
  );
};