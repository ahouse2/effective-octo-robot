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
      // 1. Delete associated agent activities
      const { error: activitiesError } = await supabase
        .from('agent_activities')
        .delete()
        .eq('case_id', caseId);

      if (activitiesError) {
        console.error("Error deleting agent activities:", activitiesError);
        throw new Error("Failed to delete associated agent activities.");
      }

      // 2. Delete associated case theories
      const { error: theoriesError } = await supabase
        .from('case_theories')
        .delete()
        .eq('case_id', caseId);

      if (theoriesError) {
        console.error("Error deleting case theories:", theoriesError);
        throw new Error("Failed to delete associated case theories.");
      }

      // 3. Delete associated case insights
      const { error: insightsError } = await supabase
        .from('case_insights')
        .delete()
        .eq('case_id', caseId);

      if (insightsError) {
        console.error("Error deleting case insights:", insightsError);
        throw new Error("Failed to delete associated case insights.");
      }

      // 4. Delete files from Supabase Storage
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

      // 5. Delete the case itself (this should be last)
      const { error: caseError } = await supabase
        .from('cases')
        .delete()
        .eq('id', caseId);

      if (caseError) {
        console.error("Error deleting case:", caseError);
        throw new Error("Failed to delete the case record.");
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