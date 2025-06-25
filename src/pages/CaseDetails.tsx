import React, { useEffect, useState } from "react";
import Layout from "@/components/Layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useParams, useNavigate, Link } from "react-router-dom";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft } from "lucide-react";
import { useSession } from "@/components/SessionContextProvider";

const caseDetailsSchema = z.object({
  name: z.string().min(1, { message: "Case name is required." }).max(100, { message: "Case name too long." }),
  type: z.string().min(1, { message: "Case type is required." }).max(50, { message: "Case type too long." }),
  caseGoals: z.string().optional(),
  systemInstruction: z.string().optional(),
  aiModel: z.enum(["openai", "gemini"], {
    required_error: "Please select an AI model.",
  }),
  openaiAssistantId: z.string().optional(),
});

type CaseDetailsFormValues = z.infer<typeof caseDetailsSchema>;

const CaseDetails = () => {
  const { caseId } = useParams<{ caseId: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [caseStatus, setCaseStatus] = useState<string | null>(null);
  const { user } = useSession();
  const [initialCaseData, setInitialCaseData] = useState<CaseDetailsFormValues | null>(null);

  const form = useForm<CaseDetailsFormValues>({
    resolver: zodResolver(caseDetailsSchema),
    defaultValues: {
      name: "",
      type: "",
      caseGoals: "",
      systemInstruction: "",
      aiModel: "openai",
      openaiAssistantId: "",
    },
  });

  useEffect(() => {
    if (!caseId) {
      toast.error("No case ID provided.");
      navigate("/case-management");
      return;
    }

    const fetchCaseDetails = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('cases')
        .select('name, type, status, case_goals, system_instruction, ai_model, openai_assistant_id')
        .eq('id', caseId)
        .single();

      if (error) {
        console.error("Error fetching case details:", error);
        toast.error("Failed to load case details. " + error.message);
        navigate("/case-management");
      } else if (data) {
        const fetchedData = {
          name: data.name,
          type: data.type,
          caseGoals: data.case_goals || "",
          systemInstruction: data.system_instruction || "",
          aiModel: (data.ai_model as "openai" | "gemini") || "openai",
          openaiAssistantId: data.openai_assistant_id || "",
        };
        form.reset(fetchedData);
        setCaseStatus(data.status);
        setInitialCaseData(fetchedData);
      }
      setLoading(false);
    };

    fetchCaseDetails();
  }, [caseId, navigate, form]);

  const onSubmit = async (values: CaseDetailsFormValues) => {
    if (!caseId || !user) {
      toast.error("Case ID or user is missing. Cannot update case.");
      return;
    }

    setIsSubmitting(true);
    const loadingToastId = toast.loading("Updating case details...");

    try {
      const { error: updateError } = await supabase
        .from('cases')
        .update({
          name: values.name,
          type: values.type,
          case_goals: values.caseGoals,
          system_instruction: values.systemInstruction,
          ai_model: values.aiModel,
          openai_assistant_id: values.aiModel === 'openai' ? (values.openaiAssistantId || null) : null,
          last_updated: new Date().toISOString(),
        })
        .eq('id', caseId);

      if (updateError) {
        throw new Error("Failed to update case: " + updateError.message);
      }

      const aiModelChanged = initialCaseData?.aiModel !== values.aiModel;
      const goalsChanged = initialCaseData?.caseGoals !== values.caseGoals;
      const instructionsChanged = initialCaseData?.systemInstruction !== values.systemInstruction;
      const assistantIdChanged = initialCaseData?.openaiAssistantId !== values.openaiAssistantId;

      if (aiModelChanged) {
        toast.info("AI model switched. Initiating setup and re-analysis...");
        await supabase.functions.invoke('ai-orchestrator', {
          body: JSON.stringify({
            caseId: caseId,
            command: 'switch_ai_model',
            payload: { newAiModel: values.aiModel },
          }),
          headers: { 'Content-Type': 'application/json', 'x-supabase-user-id': user.id },
        });
      } else if (goalsChanged || instructionsChanged || assistantIdChanged) {
        toast.info("AI assistant instructions are being updated.");
        await supabase.functions.invoke('ai-orchestrator', {
          body: JSON.stringify({
            caseId: caseId,
            command: 'update_assistant_instructions',
            payload: {},
          }),
          headers: { 'Content-Type': 'application/json', 'x-supabase-user-id': user.id },
        });
      }

      toast.success("Case details updated successfully!");
      setInitialCaseData(values); // Update initial data to prevent re-triggering on next save

    } catch (err: any) {
      console.error("Case update error:", err);
      toast.error(err.message || "An unexpected error occurred during case update.");
    } finally {
      setIsSubmitting(false);
      toast.dismiss(loadingToastId);
    }
  };

  if (loading) {
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
      <div className="container mx-auto py-8">
        <div className="flex items-center mb-8">
          <Button variant="ghost" onClick={() => navigate("/case-management")} className="mr-4">
            <ArrowLeft className="h-5 w-5 mr-2" /> Back to Cases
          </Button>
          <h1 className="text-4xl font-bold">Case Details</h1>
        </div>

        <Card className="max-w-3xl mx-auto">
          <CardHeader>
            <CardTitle>Manage Case Information</CardTitle>
            <CardDescription>View and update the core details of this case.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-6 flex items-center justify-between">
              <div>
                <Label className="text-sm font-medium">Case ID</Label>
                <p className="text-lg font-semibold text-foreground">{caseId}</p>
              </div>
              <div>
                <Label className="text-sm font-medium">Current Status</Label>
                <Badge variant={
                  caseStatus === "Analysis Complete" ? "default" :
                  caseStatus === "In Progress" ? "secondary" :
                  caseStatus === "Initial Setup" ? "outline" :
                  "outline"
                }>
                  {caseStatus}
                </Badge>
              </div>
            </div>

            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Case Name (Parties Involved)</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., John Doe vs. Jane Smith" {...field} disabled={isSubmitting} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="type"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Case Type</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., Divorce, Child Custody" {...field} disabled={isSubmitting} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="caseGoals"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Primary Case Goals</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="e.g., Prove financial misconduct, Establish primary custody"
                          className="min-h-[80px]"
                          {...field}
                          disabled={isSubmitting}
                        />
                      </FormControl>
                      <FormDescription>
                        Clearly outlining your goals will help the AI agents focus their analysis.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="systemInstruction"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>System Instructions (for AI Agents)</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Provide specific instructions or context for the AI agents. E.g., 'Focus heavily on financial documents for discrepancies.', 'Prioritize evidence related to child's welfare.', 'Ignore documents older than 2020.'"
                          className="min-h-[120px]"
                          {...field}
                          disabled={isSubmitting}
                        />
                      </FormControl>
                      <FormDescription>
                        Use this field to give the AI agents detailed directives on how to approach the analysis.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="aiModel"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>AI Model for Analysis</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value} disabled={isSubmitting}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select an AI model" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="openai">OpenAI (GPT-4o)</SelectItem>
                          <SelectItem value="gemini">Google Gemini (Requires RAG setup for full document analysis)</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormDescription>
                        This model powers the AI analysis for this specific case.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="openaiAssistantId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>OpenAI Assistant ID (Optional)</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="asst_..."
                          {...field}
                          disabled={isSubmitting || form.watch("aiModel") === "gemini"}
                          value={field.value || ""}
                        />
                      </FormControl>
                      <FormDescription>
                        If using OpenAI, you can specify a pre-configured Assistant ID. If left blank, the system will use the one created for this case or create a new one if needed. Changing this will switch the assistant used for future interactions.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" className="w-full" disabled={isSubmitting}>
                  {isSubmitting ? "Saving Changes..." : "Save Changes"}
                </Button>
              </form>
            </Form>
            <div className="mt-6 text-center">
              <Link to={`/agent-interaction/${caseId}`}>
                <Button variant="outline">Go to Agent Interaction</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
};

export default CaseDetails;