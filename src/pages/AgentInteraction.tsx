import React, { useState, useEffect } from "react";
import Layout from "@/components/Layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AgentActivityLog } from "@/components/AgentActivityLog";
import { CaseTheorySummary } from "@/components/CaseTheorySummary";
import { CaseInsightsCard } from "@/components/CaseInsightsCard";
import { CaseTimeline } from "@/components/CaseTimeline";
import { EvidenceManager } from "@/components/EvidenceManager";
import { CaseChatDisplay } from "@/components/CaseChatDisplay";
import { useParams, useNavigate } from "react-router-dom";
import { Send, Lightbulb, Upload, Edit, Search, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useSession } from "@/components/SessionContextProvider";
import { EditCaseDetailsDialog } from "@/components/EditCaseDetailsDialog";
import { FileMentionInput } from "@/components/FileMentionInput";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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
  const navigate = useNavigate();
  const [userPrompt, setUserPrompt] = useState("");
  const [webSearchQuery, setWebSearchQuery] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isSearchingWeb, setIsSearchingWeb] = useState(false);
  const [filesToUpload, setFilesToUpload] = useState<File[]>([]);
  const [isUploadingFiles, setIsUploadingFiles] = useState(false);
  const [isReanalyzing, setIsReanalyzing] = useState(false);
  const { user } = useSession();
  const [caseDetails, setCaseDetails] = useState<CaseDetails | null>(null);
  const [loadingCaseDetails, setLoadingCaseDetails] = useState(true);

  const fetchCaseDetails = async () => {
    if (!caseId) {
      toast.error("No case selected. Please select a case to interact with agents.");
      navigate("/case-management");
      return;
    }
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
      navigate("/case-management");
    } else {
      setCaseDetails(data as CaseDetails);
    }
    setLoadingCaseDetails(false);
  };

  useEffect(() => {
    fetchCaseDetails();
  }, [caseId, navigate]);

  const handleSendPrompt = async () => {
    if (!userPrompt.trim()) {
      toast.info("Please enter a message to send.");
      return;
    }
    if (!caseId || !user) {
      toast.error("Case ID or user is missing. Cannot send prompt.");
      return;
    }

    setIsSending(true);
    const loadingToastId = toast.loading("Sending prompt to agents...");

    try {
      const { data, error } = await supabase.functions.invoke(
        'send-user-prompt',
        {
          body: JSON.stringify({
            caseId: caseId,
            promptContent: userPrompt,
          }),
          headers: { 
            'Content-Type': 'application/json',
            'x-supabase-user-id': user.id
          },
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
          headers: { 
            'Content-Type': 'application/json',
            'x-supabase-user-id': user.id
          },
        }
      );

      if (error) {
        throw new Error(error.message);
      }

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
          headers: { 
            'Content-Type': 'application/json',
            'x-supabase-user-id': user.id
          },
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

  const handleReanalyzeCase = async () => {
    if (!caseId) {
      toast.error("Case ID is missing. Cannot re-analyze.");
      return;
    }
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
            payload: {}, // No specific payload needed, orchestrator will fetch data
          }),
          headers: { 'Content-Type': 'application/json', 'x-supabase-user-id': user.id },
        }
      );

      if (error) {
        throw new Error(error.message);
      }

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

  if (!caseId || loadingCaseDetails) {
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
                      <span className="font-semibold">@filename</span>: Ask a question about a specific file. Type '@' to see a list of available files.
                    </li>
                    <li>
                      <span className="font-semibold">Any other message</span>: Will be interpreted as a general instruction or question for the agents.
                    </li>
                  </ul>
                </CardContent>
              </Card>
              <div className="flex items-center space-x-2 mt-auto">
                <FileMentionInput
                  caseId={caseId}
                  placeholder="Send a message, or type '@' to mention a file..."
                  value={userPrompt}
                  onChange={setUserPrompt}
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

          {/* Right Sidebar with Tabs */}
          <div className="lg:col-span-1">
            <Tabs defaultValue="controls" className="w-full">
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="controls">Controls</TabsTrigger>
                <TabsTrigger value="summaries">Summaries</TabsTrigger>
                <TabsTrigger value="files">Files</TabsTrigger>
                <TabsTrigger value="timeline">Timeline</TabsTrigger>
              </TabsList>
              <TabsContent value="controls">
                <div className="flex flex-col space-y-4 mt-4">
                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-lg">Case Directives</CardTitle>
                      {caseDetails && (
                        <EditCaseDetailsDialog
                          caseId={caseId}
                          initialCaseGoals={caseDetails.case_goals || ""}
                          initialSystemInstruction={caseDetails.system_instruction || ""}
                          initialAiModel={caseDetails.ai_model}
                          onSaveSuccess={fetchCaseDetails}
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
                  <Card>
                    <CardHeader>
                      <CardTitle>Perform Web Search</CardTitle>
                      <CardDescription>Search the web for external information.</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="grid w-full items-center gap-1.5 mb-4">
                        <Label htmlFor="web-search-query">Search Query</Label>
                        <Input
                          id="web-search-query"
                          placeholder="e.g., 'California family law updates 2023'"
                          value={webSearchQuery}
                          onChange={(e) => setWebSearchQuery(e.target.value)}
                          disabled={isSearchingWeb}
                        />
                      </div>
                      <Button
                        onClick={handleWebSearch}
                        disabled={isSearchingWeb || !webSearchQuery.trim()}
                        className="w-full"
                      >
                        <Search className="h-4 w-4 mr-2" />
                        {isSearchingWeb ? "Searching..." : "Search Web"}
                      </Button>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader>
                      <CardTitle>Re-analyze Case</CardTitle>
                      <CardDescription>Trigger a full re-analysis of the case.</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Button
                        onClick={handleReanalyzeCase}
                        disabled={isReanalyzing}
                        className="w-full"
                      >
                        <RefreshCw className="h-4 w-4 mr-2" />
                        {isReanalyzing ? "Re-analyzing..." : "Re-run Full Analysis"}
                      </Button>
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>
              <TabsContent value="summaries">
                <div className="flex flex-col space-y-4 mt-4">
                  <CaseTheorySummary caseId={caseId} />
                  <CaseInsightsCard caseId={caseId} />
                </div>
              </TabsContent>
              <TabsContent value="files">
                <div className="flex flex-col space-y-4 mt-4">
                  <EvidenceManager caseId={caseId} />
                </div>
              </TabsContent>
              <TabsContent value="timeline">
                <div className="flex flex-col space-y-4 mt-4">
                  <CaseTimeline caseId={caseId} />
                  <Card>
                    <CardHeader>
                      <CardTitle>Detailed Activity Log</CardTitle>
                      <CardDescription>A comprehensive log of all agent actions.</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <ScrollArea className="h-[300px] pr-4">
                        <AgentActivityLog caseId={caseId} />
                      </ScrollArea>
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default AgentInteraction;