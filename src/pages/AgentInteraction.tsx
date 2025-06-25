import React, { useState, useEffect } from "react";
import Layout from "@/components/Layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { CaseTheorySummary } from "@/components/CaseTheorySummary";
import { CaseInsightsCard } from "@/components/CaseInsightsCard";
import { EvidenceManager } from "@/components/EvidenceManager";
import { CaseChatDisplay } from "@/components/CaseChatDisplay";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { useParams, useNavigate } from "react-router-dom";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useSession } from "@/components/SessionContextProvider";
import { FileMentionInput } from "@/components/FileMentionInput";
import { CaseTools } from "@/components/CaseTools";

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
  const [isSending, setIsSending] = useState(false);
  const { user } = useSession();
  const [caseDetails, setCaseDetails] = useState<CaseDetails | null>(null);
  const [loadingCaseDetails, setLoadingCaseDetails] = useState(true);

  const fetchCaseDetails = async () => {
    if (!caseId) {
      toast.error("No case selected.");
      navigate("/my-cases");
      return;
    }
    setLoadingCaseDetails(true);
    const { data, error } = await supabase
      .from('cases')
      .select('name, type, status, case_goals, system_instruction, ai_model')
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
      <div className="h-full p-4">
        <ResizablePanelGroup direction="horizontal" className="h-full rounded-lg border">
          <ResizablePanel defaultSize={25} minSize={20}>
            <div className="flex h-full flex-col space-y-4 p-4 overflow-y-auto">
              <CaseTheorySummary caseId={caseId} />
              <CaseInsightsCard caseId={caseId} />
            </div>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={50} minSize={30}>
            <div className="flex h-full flex-col">
              <CardHeader>
                <CardTitle>Agent Chat: {caseDetails?.name}</CardTitle>
                <CardDescription>Interact directly with the AI agents.</CardDescription>
              </CardHeader>
              <CardContent className="flex-1 flex flex-col overflow-hidden">
                <CaseChatDisplay caseId={caseId} />
              </CardContent>
              <div className="p-4 border-t">
                <div className="flex items-center space-x-2">
                  <FileMentionInput
                    caseId={caseId}
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
            </div>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={25} minSize={20}>
            <Tabs defaultValue="evidence" className="h-full flex flex-col">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="evidence">Evidence</TabsTrigger>
                <TabsTrigger value="tools">Tools</TabsTrigger>
              </TabsList>
              <TabsContent value="evidence" className="flex-1 overflow-auto">
                <EvidenceManager caseId={caseId} />
              </TabsContent>
              <TabsContent value="tools" className="flex-1 overflow-auto">
                <CaseTools caseId={caseId} caseDetails={caseDetails} onCaseUpdate={fetchCaseDetails} />
              </TabsContent>
            </Tabs>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </Layout>
  );
};

export default AgentInteraction;