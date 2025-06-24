import React from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Lightbulb, TrendingUp, Scale } from "lucide-react"; // Example icons

interface CaseInsightsCardProps {
  caseId: string;
  // In the future, this component would receive structured data from the AI agents
  // For now, it's a placeholder.
}

export const CaseInsightsCard: React.FC<CaseInsightsCardProps> = ({ caseId }) => {
  // Placeholder data for demonstration
  const insights = [
    {
      title: "Key Fact Identified",
      description: "Discovered a previously unrecorded financial transaction relevant to asset division.",
      icon: <Lightbulb className="h-5 w-5 text-blue-500" />,
    },
    {
      title: "Risk Assessment",
      description: "High risk of prolonged litigation due to contested child custody arrangements.",
      icon: <Scale className="h-5 w-5 text-red-500" />,
    },
    {
      title: "Potential Outcome Trend",
      description: "Early indicators suggest a favorable outcome for spousal support claims.",
      icon: <TrendingUp className="h-5 w-5 text-green-500" />,
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Key Case Insights</CardTitle>
        <CardDescription>High-level summaries and important findings from the analysis.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {insights.length > 0 ? (
            insights.map((insight, index) => (
              <div key={index} className="flex items-start space-x-3">
                <div className="flex-shrink-0 mt-1">
                  {insight.icon}
                </div>
                <div>
                  <h3 className="font-semibold text-foreground">{insight.title}</h3>
                  <p className="text-sm text-muted-foreground">{insight.description}</p>
                </div>
              </div>
            ))
          ) : (
            <p className="text-center py-4 text-muted-foreground">
              Insights will appear here as the analysis progresses.
            </p>
          )}
        </div>
        <Separator className="my-6" />
        <p className="text-sm text-muted-foreground">
          Case ID: {caseId}
        </p>
      </CardContent>
    </Card>
  );
};