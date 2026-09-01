"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
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
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { useGlobalState } from "@/app/contexts/GlobalState";
import { ManageSharedChatsDialog } from "./ManageSharedChatsDialog";
import { formatTaskUiCopy } from "@/app/utils/task-ui-copy";

const DataControlsTab = () => {
  const t = useTranslations("settings");
  const { subscription } = useGlobalState();
  const [showDeleteChats, setShowDeleteChats] = useState(false);
  const [isDeletingChats, setIsDeletingChats] = useState(false);
  const [showDeleteSandboxes, setShowDeleteSandboxes] = useState(false);
  const [isDeletingSandboxes, setIsDeletingSandboxes] = useState(false);
  const [showManageSharedChats, setShowManageSharedChats] = useState(false);

  const handleDeleteAllChats = async () => {
    if (isDeletingChats) return;
    setIsDeletingChats(true);
    try {
      const response = await fetch("/api/chats", {
        method: "DELETE",
      });

      if (!response.ok) {
        const errorMessage = await response.text();
        throw new Error(errorMessage || t("dataControls.failedDeleteTasks"));
      }

      setShowDeleteChats(false);
      window.location.href = "/";
    } catch (error) {
      console.error("Failed to delete all chats:", error);
      const errorMessage =
        error instanceof Error
          ? error.message
          : t("dataControls.failedDeleteTasks");
      toast.error(formatTaskUiCopy(errorMessage));
      setShowDeleteChats(false);
    } finally {
      setIsDeletingChats(false);
    }
  };

  const handleDeleteSandboxes = async () => {
    if (isDeletingSandboxes) return;
    setIsDeletingSandboxes(true);
    try {
      const response = await fetch("/api/delete-sandboxes", {
        method: "POST",
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || t("dataControls.failedDeleteSandbox"));
      }

      toast.success(t("dataControls.sandboxDeleted"));
    } catch (error) {
      console.error("Failed to delete sandbox:", error);
      toast.error(t("dataControls.failedDeleteTerminalSandbox"));
    } finally {
      setShowDeleteSandboxes(false);
      setIsDeletingSandboxes(false);
    }
  };

  return (
    <div className="space-y-6 min-h-0">
      {/* Manage Shared Chats Section */}
      <div>
        <div className="flex items-center justify-between py-3">
          <div>
            <div className="font-medium">
              {t("dataControls.sharedTasksTitle")}
            </div>
            <div className="text-sm text-muted-foreground mt-1">
              {t("dataControls.sharedTasksDescription")}
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowManageSharedChats(true)}
            aria-label={t("dataControls.manageSharedTasksAria")}
          >
            {t("dataControls.manage")}
          </Button>
        </div>
      </div>

      {/* Divider */}
      <div className="border-t" />

      {/* Delete All Chats Section */}
      <div>
        <div className="flex items-center justify-between py-3">
          <div>
            <div className="font-medium">
              {t("dataControls.deleteAllTasksTitle")}
            </div>
          </div>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setShowDeleteChats(true)}
            aria-label={t("dataControls.deleteAllTasksAria")}
          >
            {t("dataControls.deleteAll")}
          </Button>
        </div>
      </div>

      {/* Delete Terminal Sandbox Section - Only for subscribed users */}
      {subscription !== "free" && (
        <div>
          <div className="flex items-center justify-between py-3">
            <div>
              <div className="font-medium">
                {t("dataControls.deleteSandboxTitle")}
              </div>
              <div className="text-sm text-muted-foreground mt-1">
                {t("dataControls.deleteSandboxDescription")}
              </div>
            </div>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setShowDeleteSandboxes(true)}
              aria-label={t("dataControls.deleteSandboxAria")}
            >
              {t("dataControls.delete")}
            </Button>
          </div>
        </div>
      )}

      {/* Divider */}
      <div className="border-t" />

      {/* Security & Trust Section */}
      <div className="py-3">
        <div className="text-sm text-muted-foreground">
          {t.rich("dataControls.securityTrustNotice", {
            link: (chunks) => (
              <a
                href="/trust"
                target="_blank"
                rel="noreferrer"
                className="text-foreground underline underline-offset-2"
              >
                {chunks}
              </a>
            ),
          })}
        </div>
      </div>

      {/* Delete All Chats Confirmation Dialog */}
      <AlertDialog open={showDeleteChats} onOpenChange={setShowDeleteChats}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("dataControls.clearHistoryTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("dataControls.clearHistoryDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletingChats}>
              {t("dataControls.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteAllChats}
              disabled={isDeletingChats}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeletingChats
                ? t("dataControls.deleting")
                : t("dataControls.confirmDeletion")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Terminal Sandbox Confirmation Dialog */}
      <AlertDialog
        open={showDeleteSandboxes}
        onOpenChange={setShowDeleteSandboxes}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("dataControls.deleteSandboxConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("dataControls.deleteSandboxConfirmDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletingSandboxes}>
              {t("dataControls.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteSandboxes}
              disabled={isDeletingSandboxes}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeletingSandboxes
                ? t("dataControls.deleting")
                : t("dataControls.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Manage Shared Chats Dialog */}
      <ManageSharedChatsDialog
        open={showManageSharedChats}
        onOpenChange={setShowManageSharedChats}
      />
    </div>
  );
};

export { DataControlsTab };
