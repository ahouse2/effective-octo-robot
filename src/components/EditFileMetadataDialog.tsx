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
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Edit } from "lucide-react";

interface EditFileMetadataDialogProps {
  file: {
    id: string;
    suggested_name: string | null;
    file_name: string;
    description: string | null;
    tags: string[] | null;
    file_category: string | null;
  };
}

const formSchema = z.object({
  suggestedName: z.string().min(1, "Filename cannot be empty."),
  description: z.string().optional(),
  tags: z.string().optional(),
  category: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

export const EditFileMetadataDialog: React.FC<EditFileMetadataDialogProps> = ({ file }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      suggestedName: file.suggested_name || file.file_name,
      description: file.description || "",
      tags: file.tags?.join(", ") || "",
      category: file.file_category || "",
    },
  });

  useEffect(() => {
    if (isOpen) {
      form.reset({
        suggestedName: file.suggested_name || file.file_name,
        description: file.description || "",
        tags: file.tags?.join(", ") || "",
        category: file.file_category || "",
      });
    }
  }, [isOpen, file, form]);

  const onSubmit = async (values: FormValues) => {
    setIsSubmitting(true);
    const loadingToastId = toast.loading("Updating file metadata...");

    try {
      const tagsArray = values.tags ? values.tags.split(',').map(tag => tag.trim()).filter(Boolean) : [];

      const { error } = await supabase
        .from('case_files_metadata')
        .update({
          suggested_name: values.suggestedName,
          description: values.description,
          tags: tagsArray,
          file_category: values.category,
          last_modified_at: new Date().toISOString(),
        })
        .eq('id', file.id);

      if (error) {
        throw new Error("Failed to update metadata: " + error.message);
      }

      toast.success("File metadata updated successfully!");
      setIsOpen(false);
    } catch (err: any) {
      console.error("Metadata update error:", err);
      toast.error(err.message || "An unexpected error occurred.");
    } finally {
      setIsSubmitting(false);
      toast.dismiss(loadingToastId);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <Edit className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Edit File Details</DialogTitle>
          <DialogDescription>
            Manually override the AI-generated details for this file.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
            <FormField
              control={form.control}
              name="suggestedName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Filename</FormLabel>
                  <FormControl>
                    <Input {...field} disabled={isSubmitting} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="category"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Category</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., Financial, Communication" {...field} disabled={isSubmitting} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description / Summary</FormLabel>
                  <FormControl>
                    <Textarea className="min-h-[80px]" {...field} disabled={isSubmitting} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="tags"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tags</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., tax, invoice, custody" {...field} disabled={isSubmitting} />
                  </FormControl>
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