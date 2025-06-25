import React, { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Trash } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useSession } from "@/components/SessionContextProvider";

interface DeleteCaseDialogProps {
  caseId: string;
  caseName: string;
}

export const DeleteCaseDialog: React.FC<DeleteCaseDialogProps> = ({ caseId, caseName }) => {
  const [isDeleting, setIsDeleting] = useState(false);
  const { user } = useSession();

  const handleDelete = async () => {
    if (!user) {
      toast.error("You must be logged in to delete cases.");
      return;
    }

    setIsDeleting(true);
    const loadingToastId = toast.loading(`Deleting case "${caseName}" and all associated data...`);

    try {
      // Delete files from Supabase Storage first
      const { data: files, error: listError } = await supabase.storage
        .from('evidence-files')
        .list(`${user.id}/${caseId}/`);

      if (listError) {
        console.error("Error listing files for deletion:", listError);
        // Don't throw, continue to delete case even if files can't be listed
        toast.warning("Could not list all files for deletion. Some files might remain in storage.");
      } else if (files && files.length > 0) {
        const filePaths = files.map(file => `${user.id}/${caseId}/${file.name}`);
        const { error: deleteFilesError } = await supabase.storage
          .from('evidence-files')
          .remove(filePaths);

        if (deleteFilesError) {
          console.error("Error deleting files from storage:", deleteFilesError);
          // Don't throw, continue to delete case even if files can't be deleted
          toast.warning("Failed to delete all files from storage. Please check your storage bucket.");
        }
      }

      // Delete the case itself. Due to ON DELETE CASCADE,
      // all related records in agent_activities, case_theories,
      // case_insights, and case_files_metadata will be automatically deleted.
      const { error: caseError } = await supabase
        .from('cases')
        .delete()
        .eq('id', caseId);

      if (caseError) {
        console.error("Error deleting case:", caseError);
        throw new Error("Failed to delete the case record: " + caseError.message);
      }

      toast.success(`Case "${caseName}" and all related data deleted successfully.`);
    } catch (err: any) {
      console.error("Case deletion error:", err);
      toast.error(err.message || "An unexpected error occurred during case deletion.");
    } finally {
      setIsDeleting(false);
      toast.dismiss(loadingToastId);
    }
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" size="sm" disabled={isDeleting}>
          <Trash className="h-4 w-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
          <AlertDialogDescription>
            This action cannot be undone. This will permanently delete the case
            <span className="font-bold text-foreground"> "{caseName}" </span>
            and remove all its associated data, including agent activities, case theories, insights, and uploaded files.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleDelete} disabled={isDeleting}>
            {isDeleting ? "Deleting..." : "Delete Case"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};