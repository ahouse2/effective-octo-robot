import React from "react";
import Layout from "@/components/Layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AgentInteractionDisplay } from "@/components/AgentInteractionDisplay";
import { CaseTheorySummary } from "@/components/CaseTheorySummary";
import { useParams } from "react-router-dom";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Terminal } from "lucide-react";

const AgentInteraction = () => {
  const { caseId } = useParams<{ caseId: string }>();

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
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Agent Activity Log</CardTitle>
              <CardDescription>Observe the agents collaborating on your case analysis.</CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[600px] pr-4">
                <AgentInteractionDisplay caseId={caseId} />
              </ScrollArea>
            </CardContent>
          </Card>

          {/* Case Theory Summary */}
          <CaseTheorySummary caseId={caseId} />
        </div>
      </div>
    </Layout>
  );
};

export default AgentInteraction;