import React, { useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

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

  const form = useForm<EditCaseDetailsFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      caseGoals: initialCaseGoals,
      systemInstruction: initialSystemInstruction,
      aiModel: initialAiModel,
    },
    values: { // Ensure form values are updated when initial props change
      caseGoals: initialCaseGoals,
      systemInstruction: initialSystemInstruction,
      aiModel: initialAiModel,
    },
  });

  const onSubmit = async (values: EditCaseDetailsFormValues) => {
    setIsSubmitting(true);
    const loadingToastId = toast.loading("Saving case details...");

    try {
      const { data, error } = await supabase.functions.invoke(
        'update-case-data',
        {
          body: JSON.stringify({
            caseId: caseId,
            updateType: 'case_details', // New update type
            payload: {
              case_goals: values.caseGoals,
              system_instruction: values.systemInstruction,
              ai_model: values.aiModel,
            },
          }),
          headers: { 'Content-Type': 'application/json' },
        }
      );

      if (error) {
        throw new Error(error.message);
      }

      console.log("Case details update response:", data);
      toast.success("Case details updated successfully!");
      setIsOpen(false);
      onSaveSuccess(); // Trigger re-fetch in parent component

    } catch (err: any) {
      console.error("Error updating case details:", err);
      toast.error(err.message || "Failed to update case details. Please try again.");
    } finally {
      setIsSubmitting(false);
      toast.dismiss(loadingToastId);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">Edit Details</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Edit Case Details</DialogTitle>
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
                {isSubmitting ? "Saving..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};