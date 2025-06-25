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
import { Edit } from "lucide-react";
import { useSession } from "@/components/SessionContextProvider";

interface EditCaseDirectivesDialogProps {
  caseId: string;
  initialCaseGoals: string;
  initialSystemInstruction: string;
  onSaveSuccess: () => void;
}

const formSchema = z.object({
  caseGoals: z.string().optional(),
  systemInstruction: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

export const EditCaseDirectivesDialog: React.FC<EditCaseDirectivesDialogProps> = ({
  caseId,
  initialCaseGoals,
  initialSystemInstruction,
  onSaveSuccess,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { user } = useSession();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      caseGoals: initialCaseGoals,
      systemInstruction: initialSystemInstruction,
    },
  });

  useEffect(() => {
    if (isOpen) {
      form.reset({
        caseGoals: initialCaseGoals,
        systemInstruction: initialSystemInstruction,
      });
    }
  }, [isOpen, initialCaseGoals, initialSystemInstruction, form]);

  const onSubmit = async (values: FormValues) => {
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
          last_updated: new Date().toISOString(),
        })
        .eq('id', caseId);

      if (error) {
        throw new Error("Failed to update case directives: " + error.message);
      }

      toast.info("AI assistant instructions are being updated.");
      await supabase.functions.invoke('ai-orchestrator', {
        body: JSON.stringify({
          caseId: caseId,
          command: 'update_assistant_instructions',
          payload: {},
        }),
      });

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
            Adjust the primary goals and system instructions for the AI agents.
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
                      placeholder="Provide specific instructions or context for the AI agents. E.g., 'Focus heavily on financial documents for discrepancies.'"
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