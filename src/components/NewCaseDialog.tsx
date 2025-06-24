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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/components/SessionContextProvider";
import { useNavigate } from "react-router-dom";
import { Textarea } from "@/components/ui/textarea"; // Import Textarea

interface NewCaseDialogProps {
  onCaseCreated?: (caseId: string) => void;
}

const formSchema = z.object({
  caseType: z.string().min(2, {
    message: "Case type must be at least 2 characters.",
  }),
  partiesInvolved: z.string().min(2, {
    message: "Parties involved must be at least 2 characters.",
  }),
  caseGoals: z.string().optional(), // New field for case goals
});

export const NewCaseDialog: React.FC<NewCaseDialogProps> = ({ onCaseCreated }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { user } = useSession();
  const navigate = useNavigate();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      caseType: "",
      partiesInvolved: "",
      caseGoals: "", // Initialize caseGoals
    },
  });

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    if (!user) {
      toast.error("You must be logged in to create a case.");
      return;
    }

    setIsSubmitting(true);
    const loadingToastId = toast.loading("Creating new case...");

    try {
      const { data: caseData, error: caseError } = await supabase
        .from("cases")
        .insert([
          {
            name: values.partiesInvolved,
            type: values.caseType,
            status: "Initial Setup", // New cases start with 'Initial Setup' status
            user_id: user.id,
            case_goals: values.caseGoals, // Save case goals
          },
        ])
        .select();

      if (caseError) {
        throw new Error("Failed to create case: " + caseError.message);
      }

      const newCase = caseData[0];
      if (!newCase) {
        throw new Error("Case data not returned after creation.");
      }

      toast.success("New case created successfully!");
      form.reset();
      setIsOpen(false); // Close the dialog

      if (onCaseCreated) {
        onCaseCreated(newCase.id);
      } else {
        navigate(`/agent-interaction/${newCase.id}`); // Navigate to agent interaction for the new case
      }

    } catch (err: any) {
      console.error("Submission error:", err);
      toast.error(err.message || "An unexpected error occurred during case creation.");
    } finally {
      setIsSubmitting(false);
      toast.dismiss(loadingToastId);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button>Create New Case</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Create New Case</DialogTitle>
          <DialogDescription>
            Enter the details for your new family law case.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
            <FormField
              control={form.control}
              name="caseType"
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
              name="partiesInvolved"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Parties Involved</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., John Doe vs. Jane Smith" {...field} disabled={isSubmitting} />
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
            <DialogFooter>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Creating..." : "Create Case"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};