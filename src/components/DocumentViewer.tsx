import React, { useEffect, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Loader2, AlertTriangle, Copy } from "lucide-react";
import { Button } from "./ui/button";

// PDF.js worker configuration
// Using a specific stable version of pdfjs-dist to ensure compatibility and reliable loading.
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@3.11.17/build/pdf.worker.min.js`;

interface FileMetadata {
  id: string;
  file_name: string;
  file_path: string;
  description: string | null;
  tags: string[] | null;
  suggested_name: string | null;
  file_hash: string | null;
  hash_algorithm: string | null;
}

interface DocumentViewerProps {
  file: FileMetadata | null;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
}

export const DocumentViewer: React.FC<DocumentViewerProps> = ({ file, isOpen, onOpenChange }) => {
  const [fileContent, setFileContent] = useState<string | ArrayBuffer | null>(null);
  const [fileType, setFileType] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [numPages, setNumPages] = useState<number | null>(null);

  useEffect(() => {
    if (isOpen && file) {
      setLoading(true);
      setError(null);
      setFileContent(null);
      setFileType(null);
      setNumPages(null);

      const fetchFile = async () => {
        const { data, error: downloadError } = await supabase.storage
          .from('evidence-files')
          .download(file.file_path);

        if (downloadError) {
          setError("Failed to download file. It might have been moved or deleted.");
          toast.error("Failed to download file.");
          setLoading(false);
          return;
        }

        setFileType(data.type);

        if (data.type === 'application/pdf') {
          const buffer = await data.arrayBuffer();
          setFileContent(buffer);
        } else if (data.type.startsWith('text/')) {
          const text = await data.text();
          setFileContent(text);
        } else {
          setError(`Unsupported file type: ${data.type}. Preview is not available.`);
        }
        setLoading(false);
      };

      fetchFile();
    }
  }, [isOpen, file]);

  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
  };

  const handleCopyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard!");
  };

  const renderContent = () => {
    if (loading) {
      return (
        <div className="flex flex-col items-center justify-center h-full">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="mt-2 text-muted-foreground">Loading document...</p>
        </div>
      );
    }

    if (error) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-destructive">
          <AlertTriangle className="h-8 w-8" />
          <p className="mt-2 text-center">{error}</p>
        </div>
      );
    }

    if (!fileContent) {
      return (
        <div className="flex flex-col items-center justify-center h-full">
          <p className="text-muted-foreground">No document selected or content is empty.</p>
        </div>
      );
    }

    if (fileType === 'application/pdf') {
      return (
        <ScrollArea className="h-full">
          <Document
            file={fileContent}
            onLoadSuccess={onDocumentLoadSuccess}
            onLoadError={(err) => {
              setError(`Failed to load PDF: ${err.message}`);
              toast.error("Error loading PDF file.");
            }}
            loading={<div className="flex items-center justify-center h-full"><Loader2 className="h-8 w-8 animate-spin" /></div>}
            className="flex flex-col items-center p-4"
          >
            {Array.from(new Array(numPages), (el, index) => (
              <Page key={`page_${index + 1}`} pageNumber={index + 1} className="mb-4 shadow-lg" />
            ))}
          </Document>
        </ScrollArea>
      );
    }

    if (typeof fileContent === 'string' && fileType?.startsWith('text/')) {
      return (
        <ScrollArea className="h-full">
          <pre className="text-sm whitespace-pre-wrap p-4">{fileContent}</pre>
        </ScrollArea>
      );
    }

    return null;
  };

  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-full md:w-4/5 lg:w-3/4 xl:w-2/3 p-0">
        {file && (
          <ResizablePanelGroup direction="horizontal" className="h-full">
            <ResizablePanel defaultSize={65}>
              <div className="flex flex-col h-full">
                <SheetHeader className="p-4 border-b">
                  <SheetTitle className="truncate">{file.suggested_name || file.file_name}</SheetTitle>
                  <SheetDescription>Original filename: {file.file_name}</SheetDescription>
                </SheetHeader>
                <div className="flex-1 overflow-hidden bg-gray-100 dark:bg-gray-900">
                  {renderContent()}
                </div>
              </div>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={35}>
              <ScrollArea className="h-full p-4">
                <h3 className="text-lg font-semibold mb-2">AI Analysis & Metadata</h3>
                <div className="space-y-4">
                  <div>
                    <h4 className="font-medium mb-1">Summary</h4>
                    <p className="text-sm text-muted-foreground italic">
                      {file.description || "No summary available."}
                    </p>
                  </div>
                  <div>
                    <h4 className="font-medium mb-1">Tags</h4>
                    <div className="flex flex-wrap gap-2">
                      {file.tags && file.tags.length > 0 ? (
                        file.tags.map((tag, idx) => (
                          <Badge key={idx} variant="secondary">{tag}</Badge>
                        ))
                      ) : (
                        <p className="text-sm text-muted-foreground">No tags identified.</p>
                      )}
                    </div>
                  </div>
                  <div>
                    <h4 className="font-medium mb-1">Chain of Custody</h4>
                    {file.file_hash ? (
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">
                          {file.hash_algorithm || 'HASH'}:
                        </p>
                        <div className="flex items-center gap-2">
                          <p className="text-xs font-mono bg-muted p-1 rounded break-all">
                            {file.file_hash}
                          </p>
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleCopyToClipboard(file.file_hash!)}>
                            <Copy className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">Hash not calculated.</p>
                    )}
                  </div>
                </div>
              </ScrollArea>
            </ResizablePanel>
          </ResizablePanelGroup>
        )}
      </SheetContent>
    </Sheet>
  );
};