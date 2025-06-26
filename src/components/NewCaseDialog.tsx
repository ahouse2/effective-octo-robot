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
import { Input } from "@/components/ui/input";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/components/SessionContextProvider";
import { useNavigate } from "react-router-dom";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";

interface NewCaseDialogProps {
  onCaseCreated?: (caseId: string) => void;
}

const formSchema = z.object({
  caseType: z.string().min(2, { message: "Case type must be at least 2 characters." }),
  partiesInvolved: z.string().min(2, { message: "Parties involved must be at least 2 characters." }),
  caseGoals: z.string().optional(),
  systemInstruction: z.string().optional(),
  aiModel: z.enum(["openai", "gemini"], { required_error: "Please select an AI model." }),
  openaiAssistantId: z.string().optional(),
});

export const NewCaseDialog: React.FC<NewCaseDialogProps> = ({ onCaseCreated }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [filesToUpload, setFilesToUpload] = useState<File[]>([]);
  const { user, loading: sessionLoading } = useSession();
  const navigate = useNavigate();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      caseType: "",
      partiesInvolved: "",
      caseGoals: "",
      systemInstruction: "",
      aiModel: "openai",
      openaiAssistantId: "",
    },
  });

  useEffect(() => {
    const fetchDefaultSettings = async () => {
      if (user && !sessionLoading) {
        const { data } = await supabase
          .from('profiles')
          .select('default_ai_model, openai_assistant_id')
          .eq('id', user.id)
          .single();
        if (data) {
          form.setValue("aiModel", data.default_ai_model as "openai" | "gemini");
          form.setValue("openaiAssistantId", data.openai_assistant_id || "");
        }
      }
    };
    if (isOpen) fetchDefaultSettings();
  }, [isOpen, user, sessionLoading, form]);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      const allFiles = Array.from(event.target.files);
      const validFiles = allFiles.filter(file => !file.name.startsWith('~') && !file.name.startsWith('.'));
      const skippedCount = allFiles.length - validFiles.length;
      setFilesToUpload(validFiles);
      let toastMessage = `Selected ${validFiles.length} valid files.`;
      if (skippedCount > 0) toastMessage += ` Skipped ${skippedCount} temporary file(s).`;
      toast.info(toastMessage);
    }
  };

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    if (!user) {
      toast.error("You must be logged in to create a case.");
      return;
    }

    setIsSubmitting(true);
    const loadingToastId = toast.loading("Creating new case record...");

    try {
      const { data: caseData, error: caseError } = await supabase
        .from("cases")
        .insert([{
          name: values.partiesInvolved,
          type: values.caseType,
          status: "Initial Setup",
          user_id: user.id,
          case_goals: values.caseGoals,
          system_instruction: values.systemInstruction,
          ai_model: values.aiModel,
          openai_assistant_id: values.openaiAssistantId || null,
        }])
        .select();

      if (caseError) throw new Error("Failed to create case: " + caseError.message);
      const newCase = caseData[0];
      if (!newCase) throw new Error("Case data not returned after creation.");

      let uploadedFilePaths: string[] = [];
      if (filesToUpload.length > 0) {
        toast.loading(`Uploading ${filesToUpload.length} files...`, { id: loadingToastId });
        const uploadPromises = filesToUpload.map(async (file) => {
          const relativePath = (file as any).webkitRelativePath || file.name;
          const filePath = `${user.id}/${newCase.id}/${relativePath}`;
          const { error: uploadError } = await supabase.storage.from('evidence-files').upload(filePath, file, { upsert: true });
          if (uploadError) throw new Error(`Failed to upload ${relativePath}: ${uploadError.message}`);
          return relativePath;
        });
        uploadedFilePaths = await Promise.all(uploadPromises);
      }

      toast.loading("Starting AI analysis...", { id: loadingToastId });
      const { error: startAnalysisError } = await supabase.functions.invoke('start-analysis', {
        body: JSON.stringify({
          caseId: newCase.id,
          fileNames: uploadedFilePaths,
          caseGoals: values.caseGoals,
          systemInstruction: values.systemInstruction,
          aiModel: values.aiModel,
          openaiAssistantId: values.openaiAssistantId || null,
        }),
      });

      if (startAnalysisError) {
        throw new Error(`Failed to start analysis: ${startAnalysisError.message}`);
      }

      toast.success("Case created! AI analysis is starting in the background.", { id: loadingToastId });
      form.reset();
      setFilesToUpload([]);
      setIsOpen(false);

      if (onCaseCreated) onCaseCreated(newCase.id);
      else navigate(`/agent-interaction/${newCase.id}`);

    } catch (err: any) {
      toast.error(err.message || "An unexpected error occurred during case creation.", { id: loadingToastId });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button>Create New Case</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create New Case</DialogTitle>
          <DialogDescription>Enter the details for your new family law case.</DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[70vh] p-1">
          <Form {...form}>
            <form id="new-case-form" onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4 pr-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField control={form.control} name="caseType" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Case Type</FormLabel>
                    <FormControl><Input placeholder="e.g., Divorce, Child Custody" {...field} disabled={isSubmitting} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="partiesInvolved" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Parties Involved</FormLabel>
                    <FormControl><Input placeholder="e.g., John Doe vs. Jane Smith" {...field} disabled={isSubmitting} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <FormField control={form.control} name="caseGoals" render={({ field }) => (
                <FormItem>
                  <FormLabel>Primary Case Goals</FormLabel>
                  <FormControl><Textarea placeholder="e.g., Prove financial misconduct, Establish primary custody" className="min-h-[80px]" {...field} disabled={isSubmitting} /></FormControl>
                  <FormDescription>Clearly outlining your goals will help the AI agents focus their analysis.</FormDescription>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="systemInstruction" render={({ field }) => (
                <FormItem>
                  <FormLabel>System Instructions (for AI Agents)</FormLabel>
                  <FormControl><Textarea placeholder="Provide specific instructions or context for the AI agents..." className="min-h-[120px]" {...field} disabled={isSubmitting} /></FormControl>
                  <FormDescription>Use this field to give the AI agents detailed directives on how to approach the analysis.</FormDescription>
                  <FormMessage />
                </FormItem>
              )} />
              <FormItem>
                <FormLabel>Evidence Folder (Optional)</FormLabel>
                <FormControl>
                  <Input id="evidence-folder-upload" type="file" {...{ webkitdirectory: "", directory: "" }} onChange={handleFileChange} className="cursor-pointer" disabled={isSubmitting} />
                </FormControl>
                <FormDescription>Select the main folder containing all your evidence files. The folder structure will be preserved.</FormDescription>
                <FormMessage />
              </FormItem>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField control={form.control} name="aiModel" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Choose AI Model</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value} disabled={isSubmitting}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Select an AI model" /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="openai">OpenAI (GPT-4o)</SelectItem>
                        <SelectItem value="gemini">Google Gemini (Requires RAG setup)</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormDescription>This model will power your case analysis.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="openaiAssistantId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>OpenAI Assistant ID (Optional)</FormLabel>
                    <FormControl><Input placeholder="asst_..." {...field} disabled={isSubmitting || form.watch("aiModel") === "gemini"} value={field.value || ""} /></FormControl>
                    <FormDescription>Use a pre-configured Assistant ID.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
            </form>
          </Form>
        </ScrollArea>
        <DialogFooter>
          <Button type="submit" form="new-case-form" disabled={isSubmitting}>
            {isSubmitting ? "Creating..." : "Create Case & Start Analysis"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};