import React, { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns"; // Corrected import
import { Bot, FileText, Download, Printer, Link } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DocumentViewer } from "./DocumentViewer";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { downloadTextFile } from "@/lib/download";
import { toast } from "sonner";

interface TimelineEvent {
  id: string;
  timestamp: Date | null;
  title: string;
  description: string;
  relevant_file_ids: string[] | null;
  timeline_id: string;
}

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

interface CaseTimeline {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
}

interface TimelineDisplayProps {
  caseId: string;
}

export const TimelineDisplay: React.FC<TimelineDisplayProps> = ({ caseId }) => {
  const [allTimelineEvents, setAllTimelineEvents] = useState<TimelineEvent[]>([]);
  const [availableTimelines, setAvailableTimelines] = useState<CaseTimeline[]>([]);
  const [selectedTimelineId, setSelectedTimelineId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [allFilesMetadata, setAllFilesMetadata] = useState<FileMetadata[]>([]);
  const [isViewerOpen, setIsViewerOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<FileMetadata | null>(null);

  const fetchTimelineData = async () => {
    setLoading(true);
    setError(null);

    try {
      // Fetch all timelines for the case
      const { data: timelinesData, error: timelinesError } = await supabase
        .from("case_timelines")
        .select("id, name, description, created_at")
        .eq("case_id", caseId)
        .order("created_at", { ascending: false });

      if (timelinesError) throw timelinesError;
      setAvailableTimelines(timelinesData || []);

      // Set the first timeline as selected if none is selected
      if (!selectedTimelineId && timelinesData && timelinesData.length > 0) {
        setSelectedTimelineId(timelinesData[0].id);
      }

      // Fetch all auto-generated timeline events from case_insights
      const { data: autoEventsData, error: autoEventsError } = await supabase
        .from("case_insights")
        .select("id, timestamp, title, description, relevant_file_ids, timeline_id")
        .eq("case_id", caseId)
        .eq("insight_type", "auto_generated_event")
        .order("timestamp", { ascending: true });

      if (autoEventsError) throw autoEventsError;

      const events: TimelineEvent[] = (autoEventsData || []).map(event => ({
        id: event.id,
        timestamp: event.timestamp ? new Date(event.timestamp) : null,
        title: event.title,
        description: event.description,
        relevant_file_ids: event.relevant_file_ids,
        timeline_id: event.timeline_id,
      }));
      setAllTimelineEvents(events);

      // Fetch all file metadata for linking
      const { data: filesData, error: filesError } = await supabase
        .from('case_files_metadata')
        .select('id, file_name, file_path, description, tags, suggested_name, file_hash, hash_algorithm')
        .eq('case_id', caseId);

      if (filesError) throw filesError;
      setAllFilesMetadata(filesData || []);

    } catch (err: any) {
      console.error("Error fetching timeline data:", err);
      setError("Failed to load timeline data. Please try again.");
      toast.error("Failed to load timeline data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!caseId) {
      setError("No case ID provided for timeline.");
      setLoading(false);
      return;
    }

    fetchTimelineData();

    const channel = supabase
      .channel(`timeline_insights_for_case_${caseId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'case_insights', filter: `case_id=eq.${caseId}` }, (payload) => {
        if (payload.new && (payload.new as any).insight_type === 'auto_generated_event') {
          fetchTimelineData();
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'case_timelines', filter: `case_id=eq.${caseId}` }, () => {
        fetchTimelineData();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [caseId, selectedTimelineId]);

  const handleFileLinkClick = (fileId: string) => {
    const file = allFilesMetadata.find(f => f.id === fileId);
    if (file) {
      setSelectedFile(file);
      setIsViewerOpen(true);
    } else {
      toast.error("File not found or metadata missing. It might have been deleted or not fully processed.");
    }
  };

  const getFilePublicUrl = (filePath: string) => {
    const { data } = supabase.storage.from('evidence-files').getPublicUrl(filePath);
    return data.publicUrl;
  };

  const displayedEvents = selectedTimelineId
    ? allTimelineEvents.filter(event => event.timeline_id === selectedTimelineId)
    : [];

  const handleExportTimeline = (formatType: 'markdown' | 'text') => {
    if (displayedEvents.length === 0) {
      toast.info("No events in the selected timeline to export.");
      return;
    }

    const selectedTimeline = availableTimelines.find(t => t.id === selectedTimelineId);
    const timelineName = selectedTimeline?.name || "Untitled Timeline";
    const fileName = `${timelineName.replace(/\s+/g, '_')}_timeline.${formatType === 'markdown' ? 'md' : 'txt'}`;

    let content = `# Timeline: ${timelineName}\n\n`;
    if (selectedTimeline?.description) {
      content += `**Description:** ${selectedTimeline.description}\n\n`;
    }
    content += `Generated on: ${new Date().toLocaleString()}\n\n`;

    displayedEvents.forEach((event, index) => {
      const displayDate = event.timestamp
        ? format(event.timestamp, "MMM dd, yyyy HH:mm")
        : 'Date Unknown';

      content += `## ${displayDate} - ${event.title}\n`;
      content += `${event.description}\n`;
      if (event.relevant_file_ids && event.relevant_file_ids.length > 0) {
        content += `\n**Relevant Files:**\n`;
        event.relevant_file_ids.forEach(fileId => {
          const file = allFilesMetadata.find(f => f.id === fileId);
          if (file) {
            const fileUrl = getFilePublicUrl(file.file_path);
            content += `- [${file.suggested_name || file.file_name}](${fileUrl})\n`;
          } else {
            content += `- [File ID: ${fileId} (Not Found)]\n`;
          }
        });
      }
      content += `\n---\n\n`;
    });

    downloadTextFile(content, fileName);
  };

  const handlePrintTimeline = () => {
    const printContent = document.getElementById('timeline-print-area')?.innerHTML;
    if (!printContent) {
      toast.error("No timeline content to print.");
      return;
    }

    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(`
        <html>
          <head>
            <title>Print Timeline</title>
            <style>
              body { font-family: sans-serif; margin: 20px; }
              h1, h2, h3 { color: #333; }
              .event-item { margin-bottom: 20px; padding-bottom: 10px; border-bottom: 1px solid #eee; }
              .event-item:last-child { border-bottom: none; }
              .timestamp { font-size: 0.8em; color: #666; }
              .description { font-size: 0.9em; color: #555; }
              .file-link { font-size: 0.8em; color: #007bff; text-decoration: none; }
              .file-link:hover { text-decoration: underline; }
              .file-links-container { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
              .file-link-button { display: flex; align-items: center; padding: 4px 8px; border-radius: 4px; background: #f0f0f0; }
            </style>
          </head>
          <body>
            ${printContent}
          </body>
        </html>
      `);
      printWindow.document.close();
      printWindow.print();
    } else {
      toast.error("Could not open print window. Please allow pop-ups.");
    }
  };

  if (loading) {
    return <div className="text-center py-8 text-muted-foreground">Loading timelines...</div>;
  }

  if (error) {
    return <div className="text-center py-8 text-red-500">{error}</div>;
  }

  return (
    <Card className="h-full flex flex-col">
      <CardHeader>
        <div className="flex justify-between items-center mb-4">
          <div>
            <CardTitle>Case Timelines</CardTitle>
            <CardDescription>View and manage AI-generated chronological timelines.</CardDescription>
          </div>
          <div className="flex space-x-2">
            <Select value={selectedTimelineId || ""} onValueChange={setSelectedTimelineId}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Select a Timeline" />
              </SelectTrigger>
              <SelectContent>
                {availableTimelines.length === 0 ? (
                  <SelectItem value="no-timelines" disabled>No Timelines Available</SelectItem>
                ) : (
                  availableTimelines.map((timeline) => (
                    <SelectItem key={timeline.id} value={timeline.id}>
                      {timeline.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleExportTimeline('markdown')}
              disabled={displayedEvents.length === 0}
            >
              <Download className="h-4 w-4 mr-2" />
              Export
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handlePrintTimeline}
              disabled={displayedEvents.length === 0}
            >
              <Printer className="h-4 w-4 mr-2" />
              Print
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1 overflow-hidden">
        <ScrollArea className="h-full pr-4">
          {displayedEvents.length > 0 ? (
            <div id="timeline-print-area" className="relative pl-6 border-l-2 border-gray-200 dark:border-gray-700">
              {displayedEvents.map((event) => (
                <div key={event.id} className="mb-8 last:mb-0 event-item">
                  <div className="absolute -left-2.5 mt-1 h-4 w-4 rounded-full border-2 border-background bg-primary" />
                  <div className="ml-4">
                    <p className="text-xs text-muted-foreground timestamp">
                      {event.timestamp
                        ? format(event.timestamp, "MMM dd, yyyy HH:mm")
                        : 'Date Unknown'}
                    </p>
                    <h3 className="font-semibold text-foreground mt-1 flex items-center">
                      <Bot className="h-4 w-4 mr-2 text-blue-500" />
                      {event.title}
                    </h3>
                    <p className="text-sm text-muted-foreground description">{event.description}</p>
                    {event.relevant_file_ids && event.relevant_file_ids.length > 0 && (
                      <div className="mt-2">
                        <p className="text-xs text-muted-foreground mb-1">Supporting Documents:</p>
                        <div className="flex flex-wrap gap-2">
                          {event.relevant_file_ids.map(fileId => {
                            const file = allFilesMetadata.find(f => f.id === fileId);
                            return file ? (
                              <div key={fileId} className="flex items-center gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 px-3 text-xs"
                                  onClick={() => handleFileLinkClick(fileId)}
                                >
                                  <FileText className="h-3 w-3 mr-1" />
                                  {file.suggested_name || file.file_name}
                                </Button>
                                <a
                                  href={getFilePublicUrl(file.file_path)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-xs text-blue-500 hover:text-blue-700 flex items-center"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <Link className="h-3 w-3 mr-1" />
                                  Open in new tab
                                </a>
                              </div>
                            ) : (
                              <Button
                                key={fileId}
                                variant="outline"
                                size="sm"
                                className="h-7 px-3 text-xs text-red-500 border-red-300"
                                disabled
                                title="File not found or metadata missing."
                              >
                                <FileText className="h-3 w-3 mr-1" />
                                File Missing ({fileId.substring(0, 4)}...)
                              </Button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-center py-4 text-muted-foreground">
              {selectedTimelineId ? "No events found for this timeline. Try generating it from the 'Tools' tab." : "Select a timeline from the dropdown above, or generate a new one from the 'Tools' tab."}
            </p>
          )}
        </ScrollArea>
      </CardContent>
      <DocumentViewer
        file={selectedFile}
        isOpen={isViewerOpen}
        onOpenChange={setIsViewerOpen}
      />
    </Card>
  );
};