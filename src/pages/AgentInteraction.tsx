import React, { useState } from "react";
import Layout from "@/components/Layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AgentInteractionDisplay } from "@/components/AgentInteractionDisplay";
import { CaseTheorySummary } from "@/components/CaseTheorySummary";
import { CaseInsightsCard } from "@/components/CaseInsightsCard";
import { CaseTimeline } from "@/components/CaseTimeline";
import { useParams } from "react-router-dom";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Terminal, Send } from "lucide-react"; // Import Send icon
import { Textarea } from "@/components/ui/textarea"; // Import Textarea
import { Button } from "@/components/ui/button"; // Import Button
import { supabase } from "@/integrations/supabase/client"; // Import supabase client
import { toast } from "sonner"; // Import toast

const AgentInteraction = () => {
  const { caseId } = useParams<{ caseId: string }>();
  const [userPrompt, setUserPrompt] = useState("");
  const [isSending, setIsSending] = useState(false);

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

    try {
      const { data, error } = await supabase.functions.invoke(
        'send-user-prompt',
        {
          body: JSON.stringify({
            caseId: caseId,
            promptContent: userPrompt,
          }),
          headers: { 'Content-Type': 'application/json' },
        }
      );

      if (error) {
        throw new Error(error.message);
      }

      console.log("Prompt sent response:", data);
      toast.success("Prompt sent successfully!");
      setUserPrompt(""); // Clear input field

    } catch (err: any) {
      console.error("Error sending prompt:", err);
      toast.error(err.message || "Failed to send prompt. Please try again.");
    } finally {
      setIsSending(false);
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

  return (
    <Layout>
      <div className="container mx-auto py-8">
        <h1 className="text-4xl font-bold mb-8 text-center">Multi-Agent Case Analysis</h1>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 max-w-6xl mx-auto">
          {/* Agent Activity Log */}
          <Card className="lg:col-span-2 flex flex-col">
            <CardHeader>
              <CardTitle>Agent Activity Log</CardTitle>
              <CardDescription>Observe the agents collaborating on your case analysis.</CardDescription>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col">
              <ScrollArea className="h-[500px] pr-4 mb-4"> {/* Adjusted height to make space for input */}
                <AgentInteractionDisplay caseId={caseId} />
              </ScrollArea>
              {/* User Input for Agent Interaction */}
              <div className="flex items-center space-x-2 mt-auto">
                <Textarea
                  placeholder="Send a message or prompt to the agents..."
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

          {/* Right Sidebar for Summaries, Insights, and Timeline */}
          <div className="lg:col-span-1 flex flex-col space-y-8">
            <CaseTheorySummary caseId={caseId} />
            <CaseInsightsCard caseId={caseId} />
            <CaseTimeline caseId={caseId} />
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default AgentInteraction;