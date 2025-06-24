import React from "react";
import Layout from "@/components/Layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AgentInteractionDisplay } from "@/components/AgentInteractionDisplay";
import { CaseTheorySummary } from "@/components/CaseTheorySummary"; // Import the new component

const AgentInteraction = () => {
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
                <AgentInteractionDisplay />
              </ScrollArea>
            </CardContent>
          </Card>

          {/* Case Theory Summary */}
          <CaseTheorySummary /> {/* Use the new component here */}
        </div>
      </div>
    </Layout>
  );
};

export default AgentInteraction;