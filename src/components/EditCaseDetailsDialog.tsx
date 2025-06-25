import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Edit } from "lucide-react";
import { useSession } from "@/components/SessionContextProvider";

interface EditCaseDetailsDialogProps {
  caseId: string;
  initialCaseGoals: string;
  initialSystemInstruction: string;
  initialAiModel: "openai" | "gemini";
  onSaveSuccess: () => void;
}

const formSchema = z.object({
  caseGoals: z.string().optional(),
  systemInstruction: z.string().optional(),
  aiModel: z.enum(["openai", "gemini"], {
    required_error: "Please select an AI model.",
  }),
});

type EditCaseDetailsFormValues = z.infer<typeof formSchema>;

export const EditCaseDetailsDialog: React.FC<EditCaseDetailsDialogProps> = ({
  caseId,
  initialCaseGoals,
  initialSystemInstruction,
  initialAiModel,
  onSaveSuccess,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { user } = useSession();

  const form = useForm<EditCaseDetailsFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      caseGoals: initialCaseGoals,
      systemInstruction: initialSystemInstruction,
      aiModel: initialAiModel,
    },
  });

  useEffect(() => {
    if (isOpen) {
      form.reset({
        caseGoals: initialCaseGoals,
        systemInstruction: initialSystemInstruction,
        aiModel: initialAiModel,
      });
    }
  }, [isOpen, initialCaseGoals, initialSystemInstruction, initialAiModel, form]);

  const onSubmit = async (values: EditCaseDetailsFormValues) => {
    if (!user) {
      toast.error("You must be logged in to update case directives.");
      return;
    }
    setIsSubmitting(true);
    const loadingToastId = toast.loading("Saving case directives...");

    try {
      const { error } = await supabase
        .from('cases')
        .update({
          case_goals: values.caseGoals,
          system_instruction: values.systemInstruction,
          ai_model: values.aiModel,
          last_updated: new Date().toISOString(),
        })
        .eq('id', caseId);

      if (error) {
        throw new Error("Failed to update case directives: " + error.message);
      }

      const aiModelChanged = initialAiModel !== values.aiModel;
      if (aiModelChanged) {
        toast.info("AI model switched. Initiating setup and re-analysis...");
        await supabase.functions.invoke('ai-orchestrator', {
          body: JSON.stringify({
            caseId: caseId,
            command: 'switch_ai_model',
            payload: { newAiModel: values.aiModel },
          }),
        });
      } else {
        toast.info("AI assistant instructions are being updated.");
        await supabase.functions.invoke('ai-orchestrator', {
          body: JSON.stringify({
            caseId: caseId,
            command: 'update_assistant_instructions',
            payload: {},
          }),
        });
      }

      toast.success("Case directives updated successfully!");
      setIsOpen(false);
      onSaveSuccess();

    } catch (err: any) {
      console.error("Case directives update error:", err);
      toast.error(err.message || "An unexpected error occurred during update.");
    } finally {
      setIsSubmitting(false);
      toast.dismiss(loadingToastId);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
          <Edit className="h-4 w-4" />
          <span className="sr-only">Edit Case Directives</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Edit Case Directives</DialogTitle>
          <DialogDescription>
            Adjust the primary goals, system instructions, and AI model for this case.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
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
            <DialogFooter>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Saving Changes..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};