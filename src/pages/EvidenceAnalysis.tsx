import React, { useState, useEffect } from "react";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/components/SessionContextProvider";
import { useNavigate } from "react-router-dom";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"; // Import Select components

const formSchema = z.object({
  caseType: z.string().min(2, {
    message: "Case type must be at least 2 characters.",
  }),
  partiesInvolved: z.string().min(2, {
    message: "Parties involved must be at least 2 characters.",
  }),
  caseGoals: z.string().optional(),
  systemInstruction: z.string().optional(),
  aiModel: z.enum(["openai", "gemini"], { // New field for AI model choice
    required_error: "Please select an AI model.",
  }),
});

const EvidenceAnalysis = () => {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { user, loading: sessionLoading } = useSession();
  const navigate = useNavigate();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      caseType: "",
      partiesInvolved: "",
      caseGoals: "",
      systemInstruction: "",
      aiModel: "openai", // Default to OpenAI, will be overridden by user profile
    },
  });

  useEffect(() => {
    const fetchDefaultAiModel = async () => {
      if (user && !sessionLoading) {
        const { data, error } = await supabase
          .from('profiles')
          .select('default_ai_model')
          .eq('id', user.id)
          .single();

        if (data?.default_ai_model) {
          form.setValue("aiModel", data.default_ai_model as "openai" | "gemini");
        }
      }
    };

    fetchDefaultAiModel();
  }, [user, sessionLoading, form]);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files) {
      const fileList = Array.from(files);
      setSelectedFiles(fileList);
      toast.success(`Selected ${fileList.length} files from folder.`);
    }
  };

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    if (!user) {
      toast.error("You must be logged in to create a case.");
      return;
    }

    if (selectedFiles.length === 0) {
      toast.error("Please select at least one file to upload.");
      return;
    }

    setIsSubmitting(true);
    const loadingToastId = toast.loading("Creating case and initiating analysis...");

    try {
      // 1. Create the case in the database
      const { data: caseData, error: caseError } = await supabase
        .from("cases")
        .insert([
          {
            name: values.partiesInvolved,
            type: values.caseType,
            status: "In Progress",
            user_id: user.id,
            case_goals: values.caseGoals,
            system_instruction: values.systemInstruction,
            ai_model: values.aiModel, // Save the selected AI model
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

      // 2. Upload files to Supabase Storage
      const uploadPromises = selectedFiles.map(async (file) => {
        const filePath = `${user.id}/${newCase.id}/${file.name}`;
        const { error: uploadError } = await supabase.storage
          .from('evidence-files') // You might need to create this bucket in Supabase
          .upload(filePath, file, {
            cacheControl: '3600',
            upsert: false,
          });

        if (uploadError) {
          console.error(`Error uploading file ${file.name}:`, uploadError);
          throw new Error(`Failed to upload file ${file.name}: ${uploadError.message}`);
        }
        return file.name;
      });

      const uploadedFileNames = await Promise.all(uploadPromises);
      toast.success(`Uploaded ${uploadedFileNames.length} files.`);

      // 3. Invoke the Edge Function to start analysis
      const { data: edgeFunctionData, error: edgeFunctionError } = await supabase.functions.invoke(
        'start-analysis',
        {
          body: JSON.stringify({
            caseId: newCase.id,
            fileNames: uploadedFileNames,
            caseGoals: values.caseGoals,
            systemInstruction: values.systemInstruction,
            aiModel: values.aiModel, // Pass the selected AI model to the edge function
          }),
          headers: { 'Content-Type': 'application/json' },
        }
      );

      if (edgeFunctionError) {
        throw new Error("Failed to invoke analysis function: " + edgeFunctionError.message);
      }

      console.log("Analysis function response:", edgeFunctionData);
      toast.success("Analysis initiated successfully!");

      form.reset();
      setSelectedFiles([]);
      navigate(`/agent-interaction/${newCase.id}`);

    } catch (err: any) {
      console.error("Submission error:", err);
      toast.error(err.message || "An unexpected error occurred during submission.");
    } finally {
      setIsSubmitting(false);
      toast.dismiss(loadingToastId);
    }
  };

  return (
    <Layout>
      <div className="container mx-auto py-8">
        <h1 className="text-4xl font-bold mb-8 text-center">Evidence Analysis</h1>

        {/* Guided Questions Section */}
        <Card className="mb-8 max-w-2xl mx-auto">
          <CardHeader>
            <CardTitle>Guided Case Information</CardTitle>
            <CardDescription>Answer a few questions to help us narrow the focus of the analysis.</CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <FormField
                  control={form.control}
                  name="caseType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>What type of family law case is this?</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., Divorce, Child Custody, Paternity" {...field} />
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
                      <FormLabel>Who are the primary parties involved?</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., John Doe vs. Jane Smith" {...field} />
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
                      <FormLabel>What are your primary case goals?</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="e.g., Prove financial misconduct, Establish primary custody, Identify hidden assets"
                          className="min-h-[100px]"
                          {...field}
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
                      <FormLabel>Choose AI Model</FormLabel>
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
                        Select the AI model to power your case analysis. Note: Gemini integration for document analysis requires a separate RAG (Retrieval Augmented Generation) setup.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid w-full items-center gap-1.5">
                  <Label htmlFor="evidence-folder">Evidence Folder</Label>
                  <Input
                    id="evidence-folder"
                    type="file"
                    // @ts-ignore - webkitdirectory is a non-standard but widely supported attribute
                    webkitdirectory=""
                    directory=""
                    onChange={handleFileChange}
                    className="cursor-pointer"
                    disabled={isSubmitting}
                  />
                  {selectedFiles.length > 0 && (
                    <div className="mt-4 text-sm text-gray-600 dark:text-gray-400">
                      <p className="font-semibold">Selected Files ({selectedFiles.length}):</p>
                      <ul className="list-disc list-inside max-h-40 overflow-y-auto">
                        {selectedFiles.map((file, index) => (
                          <li key={index}>{file.name} ({ (file.size / 1024 / 1024).toFixed(2) } MB)</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
                <Button type="submit" className="w-full" disabled={isSubmitting}>
                  {isSubmitting ? "Initiating Analysis..." : "Submit Information & Start Analysis"}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
};

export default EvidenceAnalysis;