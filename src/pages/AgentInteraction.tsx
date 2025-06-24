import React, { useState, useEffect, useRef } from "react";
import Layout from "@/components/Layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AgentInteractionDisplay } from "@/components/AgentInteractionDisplay";
import { CaseTheorySummary } from "@/components/CaseTheorySummary";
import { CaseInsightsCard } from "@/components/CaseInsightsCard";
import { CaseTimeline } from "@/components/CaseTimeline";
import { CaseFilesDisplay } from "@/components/CaseFilesDisplay";
import { CaseChatDisplay } from "@/components/CaseChatDisplay";
import { useParams } from "react-router-dom";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Terminal, Send, Lightbulb, Upload, Edit } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useSession } from "@/components/SessionContextProvider";
import { EditCaseDetailsDialog } from "@/components/EditCaseDetailsDialog"; // Import the new dialog

interface CaseDetails {
  name: string;
  type: string;
  status: string;
  case_goals: string | null;
  system_instruction: string | null;
  ai_model: "openai" | "gemini";
}

const AgentInteraction = () => {
  const { caseId } = useParams<{ caseId: string }>();
  const [userPrompt, setUserPrompt] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [filesToUpload, setFilesToUpload] = useState<File[]>([]);
  const [isUploadingFiles, setIsUploadingFiles] = useState(false);
  const { user } = useSession();
  const [caseDetails, setCaseDetails] = useState<CaseDetails | null>(null);
  const [loadingCaseDetails, setLoadingCaseDetails] = useState(true);

  const fetchCaseDetails = async () => {
    if (!caseId) return;
    setLoadingCaseDetails(true);
    const { data, error } = await supabase
      .from('cases')
      .select('name, type, status, case_goals, system_instruction, ai_model')
      .eq('id', caseId)
      .single();

    if (error) {
      console.error("Error fetching case details for AgentInteraction:", error);
      toast.error("Failed to load case details.");
      setCaseDetails(null);
    } else {
      setCaseDetails(data as CaseDetails);
    }
    setLoadingCaseDetails(false);
  };

  useEffect(() => {
    fetchCaseDetails();
  }, [caseId]);

  const handleSendPrompt = async () => {
    if (!userPrompt.trim()) {
      toast.info("Please enter a message to send.");
      return;
    }
    if (!caseId) {
      toast.error("Case ID is missing. Cannot send prompt.");
      return;
    }

    setIsSending(true);
    const loadingToastId = toast.loading("Sending prompt to agents...");

    let command = 'user_prompt';
    let payload: any = { promptContent: userPrompt };

    if (userPrompt.startsWith('/websearch ')) {
      command = 'web_search';
      payload = { query: userPrompt.substring('/websearch '.length).trim() };
      if (!payload.query) {
        toast.error("Please provide a query for websearch (e.g., /websearch 'California family law').");
        setIsSending(false);
        toast.dismiss(loadingToastId);
        return;
      }
    } else if (userPrompt.startsWith('/search ')) {
      // This command is currently handled by the AI assistant's file_search tool.
      // The prompt will be sent as a regular user prompt, and the assistant will interpret it.
      // If direct client-side file search invocation is needed, this block would be expanded.
      toast.info("'/search' command will be processed by the AI assistant's file search tool.");
    }

    try {
      const { data, error } = await supabase.functions.invoke(
        'ai-orchestrator', // Invoke the orchestrator for all AI-related commands
        {
          body: JSON.stringify({
            caseId: caseId,
            command: command,
            payload: payload,
          }),
          headers: { 'Content-Type': 'application/json' },
        }
      );

      if (error) {
        throw new Error(error.message);
      }

      console.log("Prompt sent response:", data);
      toast.success("Prompt sent successfully!");
      setUserPrompt("");

    } catch (err: any) {
      console.error("Error sending prompt:", err);
      toast.error(err.message || "Failed to send prompt. Please try again.");
    } finally {
      setIsSending(false);
      toast.dismiss(loadingToastId);
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files) {
      const fileList = Array.from(files);
      setFilesToUpload(fileList);
      toast.info(`Selected ${fileList.length} files for upload.`);
    }
  };

  const handleUploadFiles = async () => {
    if (!user) {
      toast.error("You must be logged in to upload files.");
      return;
    }
    if (!caseId) {
      toast.error("Case ID is missing. Cannot upload files.");
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
        const filePath = `${user.id}/${caseId}/${file.name}`;
        const { error: uploadError } = await supabase.storage
          .from('evidence-files')
          .upload(filePath, file, {
            cacheControl: '3600',
            upsert: false,
          });

        if (uploadError) {
          console.error(`Error uploading file ${file.name}:`, uploadError);
          throw new Error(`Failed to upload file ${file.name}: ${uploadError.message}`);
        }
        return file.name;
      });

      const uploadedFileNames = await Promise.all(uploadPromises);
      toast.success(`Successfully uploaded ${uploadedFileNames.length} files.`);

      const { data: edgeFunctionData, error: edgeFunctionError } = await supabase.functions.invoke(
        'process-additional-files',
        {
          body: JSON.stringify({
            caseId: caseId,
            newFileNames: uploadedFileNames,
          }),
          headers: { 'Content-Type': 'application/json' },
        }
      );

      if (edgeFunctionError) {
        throw new Error("Failed to invoke additional file processing function: " + edgeFunctionError.message);
      }

      console.log("Additional file processing function response:", edgeFunctionData);
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

  if (!caseId) {
    return (
      <Layout>
        <div className="container mx-auto py-8">
          <Alert variant="destructive">
            <Terminal className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>
              No case ID provided. Please navigate to this page from a specific case.
            </AlertDescription>
          </Alert>
        </div>
      </Layout>
    );
  }

  if (loadingCaseDetails) {
    return (
      <Layout>
        <div className="container mx-auto py-8 text-center">
          <p className="text-lg text-gray-700 dark:text-gray-300">Loading case details...</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="container mx-auto py-8">
        <h1 className="text-4xl font-bold mb-8 text-center">Multi-Agent Case Analysis</h1>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 max-w-6xl mx-auto">
          {/* Main Content Area: Chat and User Input */}
          <Card className="lg:col-span-2 flex flex-col">
            <CardHeader>
              <CardTitle>Agent Chat</CardTitle>
              <CardDescription>Interact directly with the AI agents.</CardDescription>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col">
              <CaseChatDisplay caseId={caseId} />
              
              {/* User Input for Agent Interaction */}
              <Card className="mt-4 mb-4">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center">
                    <Lightbulb className="h-4 w-4 mr-2 text-yellow-500" />
                    Agent Interaction Tips
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  <p className="mb-2">You can send direct messages or use special commands:</p>
                  <ul className="list-disc list-inside space-y-1">
                    <li>
                      <span className="font-semibold">/search [query]</span>: Search within uploaded case files.
                      <br />
                      <span className="text-xs italic">Example: /search "financial statements for 2022"</span>
                    </li>
                    <li>
                      <span className="font-semibold">/websearch [query]</span>: Perform a web search for external information.
                      <br />
                      <span className="text-xs italic">Example: /websearch "California child support guidelines"</span>
                    </li>
                    <li>
                      <span className="font-semibold">Any other message</span>: Will be interpreted as a general instruction or question for the agents.
                    </li>
                  </ul>
                </CardContent>
              </Card>
              <div className="flex items-center space-x-2 mt-auto">
                <Textarea
                  placeholder="Send a message or prompt to the agents... (e.g., /search 'financial records', /websearch 'California family law')"
                  value={userPrompt}
                  onChange={(e) => setUserPrompt(e.target.value)}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendPrompt();
                    }
                  }}
                  disabled={isSending}
                  className="flex-1 resize-none"
                />
                <Button onClick={handleSendPrompt} disabled={isSending}>
                  <Send className="h-4 w-4 mr-2" />
                  Send
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Right Sidebar for Summaries, Insights, Timeline, Files, and Activity Log */}
          <div className="lg:col-span-1 flex flex-col space-y-8">
            {/* New Card for Case Goals and System Instructions */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-lg">Case Directives</CardTitle>
                {caseDetails && (
                  <EditCaseDetailsDialog
                    caseId={caseId}
                    initialCaseGoals={caseDetails.case_goals || ""}
                    initialSystemInstruction={caseDetails.system_instruction || ""}
                    initialAiModel={caseDetails.ai_model}
                    onSaveSuccess={fetchCaseDetails} // Re-fetch details on successful save
                  />
                )}
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground space-y-3">
                <div>
                  <h3 className="font-semibold text-foreground mb-1">Primary Case Goals:</h3>
                  <p className="whitespace-pre-wrap">{caseDetails?.case_goals || "Not specified."}</p>
                </div>
                <div>
                  <h3 className="font-semibold text-foreground mb-1">System Instructions:</h3>
                  <p className="whitespace-pre-wrap">{caseDetails?.system_instruction || "None provided."}</p>
                </div>
                <div>
                  <h3 className="font-semibold text-foreground mb-1">AI Model:</h3>
                  <p className="whitespace-pre-wrap">{caseDetails?.ai_model === 'openai' ? 'OpenAI (GPT-4o)' : 'Google Gemini'}</p>
                </div>
              </CardContent>
            </Card>

            <CaseTheorySummary caseId={caseId} />
            <CaseInsightsCard caseId={caseId} />
            <CaseFilesDisplay caseId={caseId} />
            {/* New Card for File Upload */}
            <Card>
              <CardHeader>
                <CardTitle>Upload More Evidence</CardTitle>
                <CardDescription>Add additional files to this case for analysis.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid w-full items-center gap-1.5 mb-4">
                  <Label htmlFor="additional-evidence-files">Select Files</Label>
                  <Input
                    id="additional-evidence-files"
                    type="file"
                    multiple
                    onChange={handleFileChange}
                    className="cursor-pointer"
                    disabled={isUploadingFiles}
                  />
                  {filesToUpload.length > 0 && (
                    <div className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                      <p className="font-semibold">Selected Files ({filesToUpload.length}):</p>
                      <ul className="list-disc list-inside max-h-24 overflow-y-auto">
                        {filesToUpload.map((file, index) => (
                          <li key={index}>{file.name} ({ (file.size / 1024 / 1024).toFixed(2) } MB)</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
                <Button
                  onClick={handleUploadFiles}
                  disabled={isUploadingFiles || filesToUpload.length === 0}
                  className="w-full"
                >
                  <Upload className="h-4 w-4 mr-2" />
                  {isUploadingFiles ? "Uploading..." : "Upload Files for Analysis"}
                </Button>
              </CardContent>
            </Card>
            <CaseTimeline caseId={caseId} />
            {/* Moved Agent Activity Log to the sidebar */}
            <Card>
              <CardHeader>
                <CardTitle>Detailed Activity Log</CardTitle>
                <CardDescription>A comprehensive log of all agent actions.</CardDescription>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[300px] pr-4"> {/* Adjust height as needed */}
                  <AgentInteractionDisplay caseId={caseId} />
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default AgentInteraction;