import React, { useState } from "react";
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
import { useSession } from "@/components/SessionContextProvider"; // Import useSession

const formSchema = z.object({
  caseType: z.string().min(2, {
    message: "Case type must be at least 2 characters.",
  }),
  partiesInvolved: z.string().min(2, {
    message: "Parties involved must be at least 2 characters.",
  }),
});

const EvidenceAnalysis = () => {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const { user } = useSession(); // Get the current user from the session context

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      caseType: "",
      partiesInvolved: "",
    },
  });

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

    console.log("Attempting to submit guided questions and create case:", values);
    try {
      const { data, error } = await supabase
        .from("cases")
        .insert([
          {
            name: values.partiesInvolved,
            type: values.caseType,
            status: "In Progress",
            user_id: user.id, // Associate the case with the current user
          },
        ])
        .select();

      if (error) {
        console.error("Error creating case:", error);
        toast.error("Failed to create case: " + error.message);
      } else {
        console.log("Case created successfully:", data);
        toast.success("New case created successfully!");
        form.reset();
        setSelectedFiles([]);
      }
    } catch (err) {
      console.error("Unexpected error during case creation:", err);
      toast.error("An unexpected error occurred.");
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
                <Button type="submit" className="w-full">Submit Information</Button>
              </form>
            </Form>
          </CardContent>
        </Card>

        {/* File Ingestion Section */}
        <Card className="max-w-2xl mx-auto">
          <CardHeader>
            <CardTitle>Upload Evidence Folder</CardTitle>
            <CardDescription>Select a folder containing all your evidence files for analysis.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid w-full max-w-sm items-center gap-1.5">
              <Label htmlFor="evidence-folder">Evidence Folder</Label>
              <Input
                id="evidence-folder"
                type="file"
                // @ts-ignore - webkitdirectory is a non-standard but widely supported attribute
                webkitdirectory=""
                directory=""
                onChange={handleFileChange}
                className="cursor-pointer"
              />
              {selectedFiles.length > 0 && (
                <div className="mt-4 text-sm text-gray-600 dark:text-gray-400">
                  <p className="font-semibold">Selected Files ({selectedFiles.length}):</p>
                  <ul className="list-disc list-inside max-h-40 overflow-y-auto">
                    {selectedFiles.map((file, index) => (
                      <li key={index}>{file.name} ({ (file.size / 1024 / 1024).toFixed(2) } MB)</li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs text-gray-500">
                    Note: File content is not processed on the frontend. This UI is for selection only.
                    Actual analysis requires a backend service.
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
};

export default EvidenceAnalysis;