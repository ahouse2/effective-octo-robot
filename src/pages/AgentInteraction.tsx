import React, { useState, useEffect } from "react";
import Layout from "@/components/Layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { CaseTheorySummary } from "@/components/CaseTheorySummary";
import { CaseInsightsCard } from "@/components/CaseInsightsCard";
import { EvidenceManager } from "@/components/EvidenceManager";
import { CaseChatDisplay } from "@/components/CaseChatDisplay";
import { AgentActivityLog } from "@/components/AgentActivityLog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useParams, useNavigate } from "react-router-dom";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useSession } from "@/components/SessionContextProvider";
import { FileMentionInput } from "@/components/FileMentionInput";
import { CaseTools } from "@/components/CaseTools";
import { useIsMobile } from "@/hooks/use-mobile";
import { EditCaseDirectivesDialog } from "@/components/EditCaseDirectivesDialog";
import { Progress } from "@/components/ui/progress";
import { VisualizationsTab } from "@/components/VisualizationsTab";

interface CaseDetails {
  name: string;
  type: string;
  status: string;
  case_goals: string | null;
  system_instruction: string | null;
  ai_model: "openai" | "gemini";
  analysis_progress: number | null;
  analysis_status_message: string | null;
}

const AgentInteraction = () => {
  const { caseId } = useParams<{ caseId: string }>();
  const navigate = useNavigate();
  const [userPrompt, setUserPrompt] = useState("");
  const [isSending, setIsSending] = useState(false);
  const { user } = useSession();
  const [caseDetails, setCaseDetails] = useState<CaseDetails | null>(null);
  const [loadingCaseDetails, setLoadingCaseDetails] = useState(true);
  const isMobile = useIsMobile();

  const fetchCaseDetails = async () => {
    if (!caseId) {
      toast.error("No case selected.");
      navigate("/my-cases");
      return;
    }
    setLoadingCaseDetails(true);
    const { data, error } = await supabase
      .from('cases')
      .select('name, type, status, case_goals, system_instruction, ai_model, analysis_progress, analysis_status_message')
      .eq('id', caseId)
      .single();

    if (error) {
      toast.error("Failed to load case details.");
      navigate("/my-cases");
    } else {
      setCaseDetails(data as CaseDetails);
    }
    setLoadingCaseDetails(false);
  };

  useEffect(() => {
    fetchCaseDetails();

    const channel = supabase
      .channel(`case_details_for_${caseId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'cases',
          filter: `id=eq.${caseId}`,
        },
        (payload) => {
          setCaseDetails(payload.new as CaseDetails);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [caseId, navigate]);

  const handleSendPrompt = async () => {
    if (!userPrompt.trim() || !caseId || !user) return;
    setIsSending(true);
    const loadingToastId = toast.loading("Sending command...");

    try {
      if (userPrompt.startsWith("/search ")) {
        const searchQuery = userPrompt.substring(8);
        toast.info(`Performing web search for: "${searchQuery}"`);
        const { error } = await supabase.functions.invoke('ai-orchestrator', {
          body: {
            caseId,
            command: 'web_search',
            payload: { query: searchQuery },
          },
        });
        if (error) {
          const detailedError = error.context?.error || error.message;
          throw new Error(detailedError);
        }
        toast.success("Web search initiated. Results will appear in chat.");
      } else {
        // Default behavior for regular chat messages
        const { error } = await supabase.functions.invoke('send-user-prompt', { body: { caseId, promptContent: userPrompt } });
        if (error) {
          const detailedError = error.context?.error || error.message;
          throw new Error(detailedError);
        }
        toast.success("Prompt sent successfully!");
      }
      setUserPrompt("");
    } catch (err: any) {
      toast.error(err.message || "Failed to send command.");
    } finally {
      setIsSending(false);
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

  const chatPanel = (
    <div className="flex h-full flex-col">
      <CardHeader>
        <div className="flex justify-between items-start">
          <div className="flex-1">
            <CardTitle>Agent Chat: {caseDetails?.name}</CardTitle>
            <CardDescription>Interact directly with the AI agents.</CardDescription>
            {caseDetails?.status === 'In Progress' && caseDetails.analysis_progress != null && (
              <div className="mt-2 w-full max-w-sm">
                <Progress value={caseDetails.analysis_progress} className="h-2" />
                <p className="text-xs text-muted-foreground mt-1">{caseDetails.analysis_status_message}</p>
              </div>
            )}
          </div>
          {caseDetails && (
            <EditCaseDirectivesDialog
              caseId={caseId}
              initialCaseGoals={caseDetails.case_goals || ""}
              initialSystemInstruction={caseDetails.system_instruction || ""}
              onSaveSuccess={fetchCaseDetails}
            />
          )}
        </div>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col overflow-hidden">
        <CaseChatDisplay caseId={caseId} />
      </CardContent>
      <div className="p-4 border-t">
        <div className="flex items-center space-x-2">
          <FileMentionInput
            caseId={caseId}
            placeholder="Send a message, or type '/search <query>' to search the web..."
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
    </div>
  );

  const rightPanel = (
    <Tabs defaultValue="theory" className="h-full flex flex-col">
      <TabsList className="grid w-full grid-cols-3 h-auto"> {/* Added h-auto */}
        <TabsTrigger value="theory">Theory</TabsTrigger>
        <TabsTrigger value="insights">Insights</TabsTrigger>
        <TabsTrigger value="evidence">Evidence</TabsTrigger>
        <TabsTrigger value="visualizations">Visualizations</TabsTrigger>
        <TabsTrigger value="tools">Tools</TabsTrigger>
        <TabsTrigger value="log">Log</TabsTrigger>
      </TabsList>
      <TabsContent value="theory" className="flex-1 overflow-auto p-4">
        <CaseTheorySummary caseId={caseId} />
      </TabsContent>
      <TabsContent value="insights" className="flex-1 overflow-auto p-4">
        <CaseInsightsCard caseId={caseId} />
      </TabsContent>
      <TabsContent value="evidence" className="flex-1 overflow-auto">
        <EvidenceManager caseId={caseId} />
      </TabsContent>
      <TabsContent value="visualizations" className="flex-1 overflow-auto">
        <VisualizationsTab caseId={caseId} />
      </TabsContent>
      <TabsContent value="tools" className="flex-1 overflow-auto">
        <CaseTools caseId={caseId} />
      </TabsContent>
      <TabsContent value="log" className="flex-1 overflow-auto p-2">
        <AgentActivityLog caseId={caseId} />
      </TabsContent>
    </Tabs>
  );

  if (isMobile) {
    return (
      <Layout>
        <Tabs defaultValue="chat" className="w-full">
          <TabsList className="grid w-full grid-cols-3 h-auto"> {/* Added h-auto */}
            <TabsTrigger value="chat">Chat</TabsTrigger>
            <TabsTrigger value="theory">Theory</TabsTrigger>
            <TabsTrigger value="insights">Insights</TabsTrigger>
            <TabsTrigger value="evidence">Evidence</TabsTrigger>
            <TabsTrigger value="visualizations">Visualizations</TabsTrigger>
            <TabsTrigger value="tools">Tools</TabsTrigger>
            <TabsTrigger value="log">Log</TabsTrigger>
          </TabsList>
          <TabsContent value="chat" className="h-[80vh]">{chatPanel}</TabsContent>
          <TabsContent value="theory" className="p-4"><CaseTheorySummary caseId={caseId} /></TabsContent>
          <TabsContent value="insights" className="p-4"><CaseInsightsCard caseId={caseId} /></TabsContent>
          <TabsContent value="evidence"><EvidenceManager caseId={caseId} /></TabsContent>
          <TabsContent value="visualizations"><VisualizationsTab caseId={caseId} /></TabsContent>
          <TabsContent value="tools"><CaseTools caseId={caseId} /></TabsContent>
          <TabsContent value="log" className="p-2"><AgentActivityLog caseId={caseId} /></TabsContent>
        </Tabs>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="grid grid-cols-12 h-full w-full">
        {/* Middle Panel */}
        <div className="col-span-7 h-full">
          {chatPanel}
        </div>

        {/* Right Panel */}
        <div className="col-span-5 h-full border-l">
          {rightPanel}
        </div>
      </div>
    </Layout>
  );
};

export default AgentInteraction;