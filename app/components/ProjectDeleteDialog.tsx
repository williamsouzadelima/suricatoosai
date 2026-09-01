"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import type { Doc } from "@/convex/_generated/dataModel";
import { useDeleteProject } from "@/app/hooks/useProjects";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface ProjectDeleteDialogProps {
  project: Doc<"projects">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ProjectDeleteDialog({
  project,
  open,
  onOpenChange,
}: ProjectDeleteDialogProps) {
  const deleteProject = useDeleteProject();
  const t = useTranslations("dialogs");
  const [isDeleting, setIsDeleting] = useState(false);

  const setOpen = (nextOpen: boolean) => {
    if (isDeleting) return;
    onOpenChange(nextOpen);
  };

  const handleDelete = async () => {
    if (isDeleting) return;
    setIsDeleting(true);
    try {
      await deleteProject({ projectId: project._id });
      toast.success(t("projectDelete.deleted"));
      onOpenChange(false);
    } catch (error) {
      console.error("Failed to delete project:", error);
      toast.error(t("projectDelete.deleteError"), {
        description:
          error instanceof Error ? error.message : t("projectDelete.tryAgain"),
      });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("projectDelete.title", { name: project.name })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("projectDelete.description")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>
            {t("projectDelete.cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={isDeleting}
            onClick={(event) => {
              event.preventDefault();
              void handleDelete();
            }}
          >
            {isDeleting
              ? t("projectDelete.deleting")
              : t("projectDelete.delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
