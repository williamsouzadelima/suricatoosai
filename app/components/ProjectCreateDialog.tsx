"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { FolderOpen, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Id } from "@/convex/_generated/dataModel";
import { useIsMobile } from "@/hooks/use-mobile";
import { useGlobalState } from "@/app/contexts/GlobalState";
import { useCreateProject } from "@/app/hooks/useProjects";
import { isTauriEnvironment, pickLocalFolder } from "@/app/hooks/useTauri";

interface ProjectCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (projectId: Id<"projects">, projectName: string) => void;
  showSuccessToast?: boolean;
}

const getFolderName = (path: string): string => {
  const trimmed = path.replace(/[\\/]+$/, "");
  return trimmed.split(/[\\/]/).pop() || "New project";
};

export function ProjectCreateDialog({
  open,
  onOpenChange,
  onCreated,
  showSuccessToast = true,
}: ProjectCreateDialogProps) {
  const createProject = useCreateProject();
  const t = useTranslations("dialogs");
  const isMobile = useIsMobile();
  const { desktopBridgeActive } = useGlobalState();
  const [name, setName] = useState("");
  const [folderPath, setFolderPath] = useState<string | null>(null);
  const [isPickingFolder, setIsPickingFolder] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const isDesktopApp = isTauriEnvironment();
  const folderHelpText = folderPath
    ? desktopBridgeActive
      ? t("projectCreate.folderHelpConnected")
      : t("projectCreate.folderHelpConnecting")
    : t("projectCreate.folderHelpEmpty");

  useEffect(() => {
    if (!open) {
      setName("");
      setFolderPath(null);
      setIsPickingFolder(false);
      setIsSaving(false);
    }
  }, [open]);

  const setOpen = (nextOpen: boolean) => {
    if (isSaving || isPickingFolder) return;
    onOpenChange(nextOpen);
  };

  const handleChooseFolder = async () => {
    setIsPickingFolder(true);
    try {
      const selectedPath = await pickLocalFolder();
      if (!selectedPath) return;
      setFolderPath(selectedPath);
      setName((currentName) => currentName || getFolderName(selectedPath));
    } finally {
      setIsPickingFolder(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName || isSaving) return;

    setIsSaving(true);
    try {
      const projectId = await createProject({
        name: trimmedName,
        ...(folderPath ? { folderPath } : {}),
      });
      onCreated(projectId, trimmedName);
      onOpenChange(false);
      if (showSuccessToast) toast.success(t("projectCreate.created"));
    } catch (error) {
      console.error("Failed to create project:", error);
      toast.error(t("projectCreate.createError"), {
        description:
          error instanceof Error ? error.message : t("projectCreate.tryAgain"),
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="sm:max-w-md"
        showCloseButton={!isSaving && !isPickingFolder}
      >
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{t("projectCreate.title")}</DialogTitle>
            <DialogDescription>
              {isDesktopApp
                ? t("projectCreate.descDesktop")
                : t("projectCreate.descWeb")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-5">
            <div className="space-y-2">
              <Label htmlFor="project-name">
                {t("projectCreate.nameLabel")}
              </Label>
              <Input
                id="project-name"
                name="projectName"
                autoComplete="off"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t("projectCreate.namePlaceholder")}
                maxLength={80}
                autoFocus={isMobile === false}
                disabled={isSaving}
              />
            </div>

            {isDesktopApp ? (
              <div className="space-y-2" aria-labelledby="project-folder-label">
                <p
                  id="project-folder-label"
                  className="text-sm font-medium leading-none"
                >
                  {t("projectCreate.folderLabel")}
                </p>
                {folderPath ? (
                  <div
                    className="flex items-center gap-2 rounded-lg border bg-muted/30 p-3"
                    aria-describedby="project-folder-help"
                  >
                    <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
                    <span
                      className="min-w-0 flex-1 truncate font-mono text-xs"
                      title={folderPath}
                    >
                      {folderPath}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7 shrink-0"
                      onClick={() => setFolderPath(null)}
                      disabled={isSaving}
                      aria-label={t("projectCreate.removeFolder")}
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full justify-start"
                    onClick={handleChooseFolder}
                    disabled={isPickingFolder || isSaving}
                    aria-describedby="project-folder-help"
                  >
                    <FolderOpen className="size-4" />
                    {isPickingFolder
                      ? t("projectCreate.openingPicker")
                      : t("projectCreate.useFolder")}
                  </Button>
                )}
                <p
                  id="project-folder-help"
                  className="text-xs text-muted-foreground"
                  aria-live="polite"
                >
                  {folderHelpText}
                </p>
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isSaving || isPickingFolder}
            >
              {t("projectCreate.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={!name.trim() || isSaving || isPickingFolder}
            >
              {isSaving
                ? t("projectCreate.creating")
                : t("projectCreate.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
