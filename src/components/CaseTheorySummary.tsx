import React, { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Download } from "lucide-react";
import { downloadTextFile } from "@/lib/download";

interface CaseTheory {
  id: string;
  case_id: string;
  fact_patterns: string[];
  legal_arguments: string[];
  potential_outcomes: string[];
  status: "initial" | "developing" | "refined" | "complete";
  last_updated: string;
}

interface CaseTheorySummaryProps {
  caseId: string;
}

export const CaseTheorySummary: React.FC<CaseTheorySummaryProps> = ({ caseId }) => {
  const [caseTheory, setCaseTheory] = useState<CaseTheory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!caseId) {
      setError("No case ID provided for case theory.");
      setLoading(false);
      return;
    }

    const fetchCaseTheory = async () => {
      setLoading(true);
      setError(null);
      const { data, error } = await supabase
        .from("case_theories")
        .select("*")
        .eq("case_id", caseId)
        .single();

      if (error && error.code !== 'PGRST116') {
        console.error("Error fetching case theory:", error);
        setError("Failed to load case theory. Please try again.");
        toast.error("Failed to load case theory.");
        setCaseTheory(null);
      } else if (data) {
        setCaseTheory(data);
      } else {
        setCaseTheory(null);
      }
      setLoading(false);
    };

    fetchCaseTheory();

    const channel = supabase
      .channel(`case_theories_for_case_${caseId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'case_theories', filter: `case_id=eq.${caseId}` },
        (payload) => {
          console.log('Case theory change received!', payload);
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            setCaseTheory(payload.new as CaseTheory);
          } else if (payload.eventType === 'DELETE') {
            setCaseTheory(null);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [caseId]);

  const handleExportTheory = () => {
    if (!caseTheory) {
      toast.info("No case theory data to export.");
      return;
    }

    let content = `# Case Theory for Case ID: ${caseId}\n\n`;
    content += `Status: ${caseTheory.status}\n`;
    content += `Last Updated: ${new Date(caseTheory.last_updated).toLocaleString()}\n\n`;

    content += `## Fact Patterns:\n`;
    if (caseTheory.fact_patterns && caseTheory.fact_patterns.length > 0) {
      caseTheory.fact_patterns.forEach((fact) => {
        content += `- ${fact}\n`;
      });
    } else {
      content += `[No fact patterns yet]\n`;
    }
    content += `\n`;

    content += `## Legal Arguments:\n`;
    if (caseTheory.legal_arguments && caseTheory.legal_arguments.length > 0) {
      caseTheory.legal_arguments.forEach((arg) => {
        content += `- ${arg}\n`;
      });
    } else {
      content += `[No legal arguments yet]\n`;
    }
    content += `\n`;

    content += `## Potential Outcomes:\n`;
    if (caseTheory.potential_outcomes && caseTheory.potential_outcomes.length > 0) {
      caseTheory.potential_outcomes.forEach((outcome) => {
        content += `- ${outcome}\n`;
      });
    } else {
      content += `[No potential outcomes yet]\n`;
    }

    downloadTextFile(content, `case_theory_${caseId}.txt`);
  };

  if (loading) {
    return <div className="text-center py-8">Loading case theory...</div>;
  }

  if (error) {
    return <div className="text-center py-8 text-red-500">{error}</div>;
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-x-4">
        <div className="flex-grow">
          <CardTitle>Current Case Theory</CardTitle>
          <CardDescription>The evolving legal theory compiled by the agents.</CardDescription>
        </div>
        <div className="flex-shrink-0">
          <button
            onClick={handleExportTheory}
            disabled={!caseTheory}
            className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-9 px-3"
          >
            <Download className="h-4 w-4 mr-2" /> Export
          </button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4 text-sm text-muted-foreground">
          <div>
            <h3 className="font-semibold text-foreground mb-1">Fact Patterns:</h3>
            {caseTheory?.fact_patterns && caseTheory.fact_patterns.length > 0 ? (
              <ul className="list-disc list-inside space-y-1">
                {caseTheory.fact_patterns.map((fact, index) => (
                  <li key={index}>{fact}</li>
                ))}
              </ul>
            ) : (
              <p>[Awaiting analysis...]</p>
            )}
          </div>
          <Separator />
          <div>
            <h3 className="font-semibold text-foreground mb-1">Legal Arguments:</h3>
            {caseTheory?.legal_arguments && caseTheory.legal_arguments.length > 0 ? (
              <ul className="list-disc list-inside space-y-1">
                {caseTheory.legal_arguments.map((arg, index) => (
                  <li key={index}>{arg}</li>
                ))}
              </ul>
            ) : (
              <p>[Awaiting analysis...]</p>
            )}
          </div>
          <Separator />
          <div>
            <h3 className="font-semibold text-foreground mb-1">Potential Outcomes:</h3>
            {caseTheory?.potential_outcomes && caseTheory.potential_outcomes.length > 0 ? (
              <ul className="list-disc list-inside space-y-1">
                {caseTheory.potential_outcomes.map((outcome, index) => (
                  <li key={index}>{outcome}</li>
                ))}
              </ul>
            ) : (
              <p>[Awaiting analysis...]</p>
            )}
          </div>
          {caseTheory && (
            <p className="text-xs text-right text-muted-foreground mt-4">
              Last Updated: {new Date(caseTheory.last_updated).toLocaleString()}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
};