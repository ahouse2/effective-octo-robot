import React, { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Lightbulb, TrendingUp, Scale, Info, Download } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { downloadTextFile } from "@/lib/download";

interface CaseInsight {
  id: string;
  case_id: string;
  title: string;
  description: string;
  insight_type: 'key_fact' | 'risk_assessment' | 'outcome_trend' | 'general';
  timestamp: string;
}

interface CaseInsightsCardProps {
  caseId: string;
}

export const CaseInsightsCard: React.FC<CaseInsightsCardProps> = ({ caseId }) => {
  const [insights, setInsights] = useState<CaseInsight[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!caseId) {
      setError("No case ID provided for insights.");
      setLoading(false);
      return;
    }

    const fetchCaseInsights = async () => {
      setLoading(true);
      setError(null);
      const { data, error } = await supabase
        .from("case_insights")
        .select("*")
        .eq("case_id", caseId)
        .order("timestamp", { ascending: false });

      if (error) {
        console.error("Error fetching case insights:", error);
        setError("Failed to load case insights. Please try again.");
        toast.error("Failed to load case insights.");
      } else {
        setInsights(data || []);
      }
      setLoading(false);
    };

    fetchCaseInsights();

    const channel = supabase
      .channel(`case_insights_for_case_${caseId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'case_insights', filter: `case_id=eq.${caseId}` },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setInsights((prev) => [payload.new as CaseInsight, ...prev].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()));
          } else if (payload.eventType === 'UPDATE') {
            setInsights((prev) =>
              prev.map((insight) =>
                insight.id === payload.old.id ? (payload.new as CaseInsight) : insight
              ).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
            );
          } else if (payload.eventType === 'DELETE') {
            setInsights((prev) => prev.filter((insight) => insight.id !== payload.old.id));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [caseId]);

  const getInsightIcon = (type: CaseInsight["insight_type"]) => {
    switch (type) {
      case "key_fact":
        return <Lightbulb className="h-5 w-5 text-blue-500" />;
      case "risk_assessment":
        return <Scale className="h-5 w-5 text-red-500" />;
      case "outcome_trend":
        return <TrendingUp className="h-5 w-5 text-green-500" />;
      case "general":
      default:
        return <Info className="h-5 w-5 text-gray-500" />;
    }
  };

  const handleExportInsights = () => {
    if (insights.length === 0) {
      toast.info("No insights data to export.");
      return;
    }

    let content = `# Case Insights for Case ID: ${caseId}\n\n`;
    insights.forEach((insight, index) => {
      content += `## ${insight.title}\n`;
      content += `Type: ${insight.insight_type}\n`;
      content += `Timestamp: ${new Date(insight.timestamp).toLocaleString()}\n`;
      content += `Description:\n${insight.description}\n\n`;
      if (index < insights.length - 1) {
        content += `---\n\n`;
      }
    });

    downloadTextFile(content, `case_insights_${caseId}.txt`);
  };

  if (loading) {
    return <div className="text-center py-8">Loading insights...</div>;
  }

  if (error) {
    return <div className="text-center py-8 text-red-500">{error}</div>;
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-start gap-4">
          <div>
            <CardTitle>Key Case Insights</CardTitle>
            <CardDescription>High-level summaries and important findings from the analysis.</CardDescription>
          </div>
          <button
            onClick={handleExportInsights}
            disabled={insights.length === 0}
            className="flex-shrink-0 inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-9 px-3"
          >
            <Download className="h-4 w-4 mr-2" />
            <span>Export</span>
          </button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {insights.length > 0 ? (
            insights.map((insight) => (
              <div key={insight.id} className="flex items-start space-x-3">
                <div className="flex-shrink-0 mt-1">
                  {getInsightIcon(insight.insight_type || 'general')}
                </div>
                <div>
                  <h3 className="font-semibold text-foreground">{insight.title}</h3>
                  <p className="text-sm text-muted-foreground">{insight.description}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {new Date(insight.timestamp).toLocaleString()}
                  </p>
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