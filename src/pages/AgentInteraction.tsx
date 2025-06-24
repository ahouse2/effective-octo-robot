import React from "react";
import Layout from "@/components/Layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AgentInteractionDisplay } from "@/components/AgentInteractionDisplay";

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
          <Card>
            <CardHeader>
              <CardTitle>Current Case Theory</CardTitle>
              <CardDescription>The evolving legal theory compiled by the agents.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4 text-sm text-muted-foreground">
                <p>
                  As the agents process information, the case theory will be dynamically built here.
                  This section will summarize the key facts, legal arguments, and potential outcomes.
                </p>
                <p>
                  <strong>Fact Patterns:</strong> [Awaiting analysis...]
                </p>
                <p>
                  <strong>Legal Arguments:</strong> [Awaiting analysis...]
                </p>
                <p>
                  <strong>Potential Outcomes:</strong> [Awaiting analysis...]
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </Layout>
  );
};

export default AgentInteraction;