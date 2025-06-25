import React, { useState, useEffect } from "react";
import Layout from "@/components/Layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { CaseTheorySummary } from "@/components/CaseTheorySummary";
import { CaseInsightsCard } from "@/components/CaseInsightsCard";
import { EvidenceManager } from "@/components/EvidenceManager";
import { CaseChatDisplay } from "@/components/CaseChatDisplay";
import { AgentActivityLog } from "@/components/AgentActivityLog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useParams, useNavigate, Link } from "react-router-dom";
import { Send, Upload, Search, RefreshCw, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useSession } from "@/components/SessionContextProvider";
import { FileMentionInput } from "@/components/FileMentionInput";

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
  const [caseDetails, setCaseDetails] = useState<{ name: string } | null>(null);
  const [loadingCaseDetails, setLoadingCaseDetails] = useState(true);

  useEffect(() => {
    if (!caseId) {
      toast.error("No case selected.");
      navigate("/my-cases");
      return;
    }
    const fetchCaseDetails = async () => {
      setLoadingCaseDetails(true);
      const { data, error } = await supabase
        .from('cases')
        .select('name')
        .eq('id', caseId)
        .single();

      if (error) {
        toast.error("Failed to load case details.");
        navigate("/my-cases");
      } else {
        setCaseDetails(data);
      }
      setLoadingCaseDetails(false);
    };
    fetchCaseDetails();
  }, [caseId, navigate]);

  const handleSendPrompt = async () => {
    if (!userPrompt.trim() || !caseId || !user) return;
    setIsSending(true);
    const loadingToastId = toast.loading("Sending prompt...");
    try {
      const { error } = await supabase.functions.invoke('send-user-prompt', { body: { caseId, promptContent: userPrompt } });
      if (error) throw error;
      toast.success("Prompt sent successfully!");
      setUserPrompt("");
    } catch (err: any) {
      toast.error(err.message || "Failed to send prompt.");
    } finally {
      setIsSending(false);
      toast.dismiss(loadingToastId);
    }
  };

  const handleWebSearch = async () => {
    if (!webSearchQuery.trim() || !caseId || !user) return;
    setIsSearchingWeb(true);
    const loadingToastId = toast.loading("Performing web search...");
    try {
      const { error } = await supabase.functions.invoke('ai-orchestrator', { body: { caseId, command: 'web_search', payload: { query: webSearchQuery } } });
      if (error) throw error;
      toast.success("Web search initiated!");
      setWebSearchQuery("");
    } catch (err: any) {
      toast.error(err.message || "Failed to perform web search.");
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
    if (filesToUpload.length === 0 || !caseId || !user) return;
    setIsUploadingFiles(true);
    const loadingToastId = toast.loading(`Uploading ${filesToUpload.length} files...`);
    try {
      const uploadPromises = filesToUpload.map(async (file) => {
        const relativePath = (file as any).webkitRelativePath || file.name;
        const filePath = `${user.id}/${caseId}/${relativePath}`;
        const { error } = await supabase.storage.from('evidence-files').upload(filePath, file, { upsert: true });
        if (error) throw new Error(`Failed to upload ${relativePath}: ${error.message}`);
        return relativePath;
      });
      const uploadedFilePaths = await Promise.all(uploadPromises);
      toast.success(`Successfully uploaded ${uploadedFilePaths.length} files.`);
      const { error } = await supabase.functions.invoke('process-additional-files', { body: { caseId, newFileNames: uploadedFilePaths } });
      if (error) throw new Error(`Failed to process files: ${error.message}`);
      toast.success("New files submitted for analysis!");
      setFilesToUpload([]);
    } catch (err: any) {
      toast.error(err.message || "An error occurred during upload.");
    } finally {
      setIsUploadingFiles(false);
      toast.dismiss(loadingToastId);
    }
  };

  const handleReanalyzeCase = async () => {
    if (!caseId || !user) return;
    setIsReanalyzing(true);
    const loadingToastId = toast.loading("Initiating full case re-analysis...");
    try {
      const { error } = await supabase.functions.invoke('ai-orchestrator', { body: { caseId, command: 're_run_analysis', payload: {} } });
      if (error) throw error;
      toast.success("Case re-analysis initiated!");
    } catch (err: any) {
      toast.error(err.message || "Failed to re-analyze case.");
    } finally {
      setIsReanalyzing(false);
      toast.dismiss(loadingToastId);
    }
  };

  if (loadingCaseDetails) {
    return <Layout><div className="text-center py-8">Loading Case...</div></Layout>;
  }

  return (
    <Layout>
      <div className="container mx-auto py-8">
        <div className="flex items-center mb-6">
          <Button variant="ghost" size="sm" onClick={() => navigate("/my-cases")} className="mr-2">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-3xl font-bold">
            Case: <span className="text-primary">{caseDetails?.name || '...'}</span>
          </h1>
        </div>

        <Tabs defaultValue="hub" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="hub">Analysis Hub</TabsTrigger>
            <TabsTrigger value="chat">Agent Chat</TabsTrigger>
            <TabsTrigger value="evidence">Evidence Locker</TabsTrigger>
            <TabsTrigger value="log">Full Activity Log</TabsTrigger>
          </TabsList>

          <TabsContent value="hub" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle>Analysis Hub</CardTitle>
                <CardDescription>High-level intelligence and key findings generated by the AI agents.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <CaseTheorySummary caseId={caseId!} />
                <CaseInsightsCard caseId={caseId!} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="chat" className="mt-6">
            <Card>
              <CardHeader>
                <div className="flex justify-between items-center">
                  <div>
                    <CardTitle>Agent Chat</CardTitle>
                    <CardDescription>Interact with the AI, perform web searches, or re-run the analysis.</CardDescription>
                  </div>
                  <div className="flex items-center space-x-2">
                    <div className="flex items-center space-x-2">
                      <Input
                        id="web-search-query"
                        placeholder="Search the web..."
                        value={webSearchQuery}
                        onChange={(e) => setWebSearchQuery(e.target.value)}
                        disabled={isSearchingWeb}
                        className="w-48"
                      />
                      <Button onClick={handleWebSearch} disabled={isSearchingWeb || !webSearchQuery.trim()} size="sm">
                        <Search className="h-4 w-4 mr-2" /> Search
                      </Button>
                    </div>
                    <Button onClick={handleReanalyzeCase} disabled={isReanalyzing} variant="outline" size="sm">
                      <RefreshCw className="h-4 w-4 mr-2" /> Re-run Analysis
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="h-[60vh] flex flex-col">
                  <CaseChatDisplay caseId={caseId!} />
                  <div className="flex items-center space-x-2 mt-4">
                    <FileMentionInput
                      caseId={caseId!}
                      placeholder="Send a message, or type '@' to mention a file..."
                      value={userPrompt}
                      onChange={setUserPrompt}
                      onKeyPress={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendPrompt(); }}}
                      disabled={isSending}
                      className="flex-1 resize-none"
                    />
                    <Button onClick={handleSendPrompt} disabled={isSending}>
                      <Send className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="evidence" className="mt-6">
            <Card>
              <CardHeader>
                <div className="flex justify-between items-center">
                  <div>
                    <CardTitle>Evidence Locker</CardTitle>
                    <CardDescription>Upload and manage all evidence files for this case.</CardDescription>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Label htmlFor="evidence-folder-upload" className="cursor-pointer">
                      <Button asChild>
                        <span><Upload className="h-4 w-4 mr-2" /> Upload Folder</span>
                      </Button>
                    </Label>
                    <Input
                      id="evidence-folder-upload"
                      type="file"
                      // @ts-ignore
                      webkitdirectory=""
                      directory=""
                      onChange={handleFileChange}
                      className="hidden"
                      disabled={isUploadingFiles}
                    />
                    {filesToUpload.length > 0 && (
                      <Button onClick={handleUploadFiles} disabled={isUploadingFiles}>
                        {isUploadingFiles ? "Uploading..." : `Confirm Upload (${filesToUpload.length})`}
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <EvidenceManager caseId={caseId!} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="log" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle>Full Activity Log</CardTitle>
                <CardDescription>A detailed, chronological log of every action taken by the system and AI agents.</CardDescription>
              </CardHeader>
              <CardContent>
                <AgentActivityLog caseId={caseId!} />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
};

export default AgentInteraction;