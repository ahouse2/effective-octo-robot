import React, { useEffect, useState } from "react";
import Layout from "@/components/Layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useParams, useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft } from "lucide-react";
import { EditCaseDetailsDialog } from "@/components/EditCaseDetailsDialog"; // Import the dialog

interface CaseDetailsData {
  name: string;
  type: string;
  status: string;
  case_goals: string | null;
  system_instruction: string | null;
  ai_model: "openai" | "gemini";
  last_updated: string;
}

const CaseDetails = () => {
  const { caseId } = useParams<{ caseId: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [caseDetails, setCaseDetails] = useState<CaseDetailsData | null>(null);

  const fetchCaseDetails = async () => {
    if (!caseId) {
      toast.error("No case ID provided.");
      navigate("/case-management");
      return;
    }

    setLoading(true);
    const { data, error } = await supabase
      .from('cases')
      .select('name, type, status, case_goals, system_instruction, ai_model, last_updated')
      .eq('id', caseId)
      .single();

    if (error) {
      console.error("Error fetching case details:", error);
      toast.error("Failed to load case details. " + error.message);
      setCaseDetails(null);
      // Optionally navigate back or show a more prominent error
    } else if (data) {
      setCaseDetails(data as CaseDetailsData);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchCaseDetails();
  }, [caseId, navigate]);

  if (loading) {
    return (
      <Layout>
        <div className="container mx-auto py-8 text-center">
          <p className="text-lg text-gray-700 dark:text-gray-300">Loading case details...</p>
        </div>
      </Layout>
    );
  }

  if (!caseDetails) {
    return (
      <Layout>
        <div className="container mx-auto py-8 text-center text-red-500">
          <p className="text-lg">Case not found or an error occurred.</p>
          <Button onClick={() => navigate("/case-management")} className="mt-4">
            Back to Case Management
          </Button>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="container mx-auto py-8">
        <div className="flex items-center mb-8">
          <Button variant="ghost" onClick={() => navigate("/case-management")} className="mr-4">
            <ArrowLeft className="h-5 w-5 mr-2" /> Back to Cases
          </Button>
          <h1 className="text-4xl font-bold">Case Details</h1>
        </div>

        <Card className="max-w-3xl mx-auto">
          <CardHeader>
            <CardTitle>Case Information</CardTitle>
            <CardDescription>Overview of the core details for this case.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-y-4 gap-x-8 mb-6">
              <div>
                <Label className="text-sm font-medium">Case ID</Label>
                <p className="text-lg font-semibold text-foreground break-all">{caseId}</p>
              </div>
              <div>
                <Label className="text-sm font-medium">Case Name (Parties Involved)</Label>
                <p className="text-lg font-semibold text-foreground">{caseDetails.name}</p>
              </div>
              <div>
                <Label className="text-sm font-medium">Case Type</Label>
                <p className="text-lg font-semibold text-foreground">{caseDetails.type}</p>
              </div>
              <div>
                <Label className="text-sm font-medium">Current Status</Label>
                <Badge variant={
                  caseDetails.status === "Analysis Complete" ? "default" :
                  caseDetails.status === "In Progress" ? "secondary" :
                  caseDetails.status === "Initial Setup" ? "outline" :
                  "outline"
                }>
                  {caseDetails.status}
                </Badge>
              </div>
              <div className="md:col-span-2">
                <Label className="text-sm font-medium">Primary Case Goals</Label>
                <p className="text-base text-muted-foreground whitespace-pre-wrap">{caseDetails.case_goals || "Not specified."}</p>
              </div>
              <div className="md:col-span-2">
                <Label className="text-sm font-medium">System Instructions (for AI Agents)</Label>
                <p className="text-base text-muted-foreground whitespace-pre-wrap">{caseDetails.system_instruction || "None provided."}</p>
              </div>
              <div>
                <Label className="text-sm font-medium">AI Model</Label>
                <p className="text-base text-muted-foreground">{caseDetails.ai_model === 'openai' ? 'OpenAI (GPT-4o)' : 'Google Gemini'}</p>
              </div>
              <div>
                <Label className="text-sm font-medium">Last Updated</Label>
                <p className="text-base text-muted-foreground">{new Date(caseDetails.last_updated).toLocaleString()}</p>
              </div>
            </div>

            <div className="mt-6 flex justify-center space-x-4">
              <EditCaseDetailsDialog
                caseId={caseId}
                initialCaseGoals={caseDetails.case_goals || ""}
                initialSystemInstruction={caseDetails.system_instruction || ""}
                initialAiModel={caseDetails.ai_model}
                onSaveSuccess={fetchCaseDetails} // Re-fetch details on successful save
              />
              <Button variant="outline" onClick={() => navigate(`/agent-interaction/${caseId}`)}>
                Go to Agent Interaction
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
};

export default CaseDetails;