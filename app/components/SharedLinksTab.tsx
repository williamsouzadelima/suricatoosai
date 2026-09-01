"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { SharedChat } from "@/types";
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
import { Copy, Trash2, ExternalLink, Share2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { formatTaskTitle } from "@/app/utils/task-ui-copy";

const SharedLinksTab = () => {
  const t = useTranslations("settings");
  const sharedChats = useQuery(api.sharedChats.getUserSharedChats);
  const unshareChat = useMutation(api.sharedChats.unshareChat);
  const unshareAllChats = useMutation(api.sharedChats.unshareAllChats);

  const [showUnshareAll, setShowUnshareAll] = useState(false);
  const [isUnsharingAll, setIsUnsharingAll] = useState(false);
  const [unshareTarget, setUnshareTarget] = useState<string | null>(null);
  const [isUnsharing, setIsUnsharing] = useState(false);

  const handleCopyLink = async (shareId: string, chatTitle: string) => {
    const shareUrl = `${window.location.origin}/share/${shareId}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.success(
        t("sharedLinks.linkCopied", { title: formatTaskTitle(chatTitle) }),
      );
    } catch (error) {
      console.error("Failed to copy share link:", error);
      toast.error(t("sharedLinks.copyLinkError"));
    }
  };

  const handleOpenShare = (shareId: string) => {
    const shareUrl = `${window.location.origin}/share/${shareId}`;
    window.open(shareUrl, "_blank");
  };

  const handleUnshare = async (chatId: string, chatTitle: string) => {
    if (isUnsharing) return;
    setIsUnsharing(true);
    try {
      await unshareChat({ chatId });
      toast.success(
        t("sharedLinks.noLongerShared", { title: formatTaskTitle(chatTitle) }),
      );
    } catch (error) {
      console.error("Failed to unshare chat:", error);
      toast.error(t("sharedLinks.failedUnshare"));
    } finally {
      setUnshareTarget(null);
      setIsUnsharing(false);
    }
  };

  const handleUnshareAll = async () => {
    if (isUnsharingAll) return;
    setIsUnsharingAll(true);
    try {
      await unshareAllChats();
      toast.success(t("sharedLinks.allUnshared"));
    } catch (error) {
      console.error("Failed to unshare all chats:", error);
      toast.error(t("sharedLinks.failedUnshareAll"));
    } finally {
      setShowUnshareAll(false);
      setIsUnsharingAll(false);
    }
  };

  const formatShareDate = (timestamp: number) => {
    return formatDistanceToNow(new Date(timestamp), { addSuffix: true });
  };

  // Loading state
  if (sharedChats === undefined) {
    return (
      <div className="space-y-6 min-h-0">
        <div className="flex items-center justify-center py-8">
          <div className="text-sm text-muted-foreground">
            {t("sharedLinks.loading")}
          </div>
        </div>
      </div>
    );
  }

  // Empty state
  if (sharedChats.length === 0) {
    return (
      <div className="space-y-6 min-h-0">
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Share2 className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium mb-2">
            {t("sharedLinks.emptyTitle")}
          </h3>
          <p className="text-sm text-muted-foreground max-w-sm">
            {t("sharedLinks.emptyDescription")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 min-h-0">
      {/* Header with Unshare All button */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium">
            {t("sharedLinks.header", { count: sharedChats.length })}
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            {t("sharedLinks.description")}
          </p>
        </div>
        {sharedChats.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowUnshareAll(true)}
            aria-label={t("sharedLinks.unshareAllAria")}
          >
            {t("sharedLinks.unshareAll")}
          </Button>
        )}
      </div>

      {/* Shared Chats List */}
      <div className="space-y-3">
        {sharedChats.map((chat: SharedChat) => (
          <div
            key={chat.id}
            className="flex items-center justify-between p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
          >
            <div className="flex-1 min-w-0 mr-4">
              <div className="font-medium truncate">
                {formatTaskTitle(chat.title)}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {t("sharedLinks.sharedAgo", {
                  time: formatShareDate(chat.share_date!),
                })}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleCopyLink(chat.share_id!, chat.title)}
                aria-label={t("sharedLinks.copyAria")}
                title={t("sharedLinks.copyTitle")}
              >
                <Copy className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleOpenShare(chat.share_id!)}
                aria-label={t("sharedLinks.openAria")}
                title={t("sharedLinks.openTitle")}
              >
                <ExternalLink className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setUnshareTarget(chat.id)}
                aria-label={t("sharedLinks.unshareAria")}
                title={t("sharedLinks.unshareTitle")}
                className="text-destructive hover:text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      {/* Unshare Single Chat Confirmation Dialog */}
      <AlertDialog
        open={unshareTarget !== null}
        onOpenChange={(open) => !open && setUnshareTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("sharedLinks.unshareOneTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("sharedLinks.unshareOneDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isUnsharing}>
              {t("sharedLinks.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (unshareTarget) {
                  const chat = sharedChats.find(
                    (c: SharedChat) => c.id === unshareTarget,
                  );
                  if (chat) {
                    handleUnshare(unshareTarget, chat.title);
                  }
                }
              }}
              disabled={isUnsharing}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isUnsharing
                ? t("sharedLinks.unsharing")
                : t("sharedLinks.unshare")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Unshare All Confirmation Dialog */}
      <AlertDialog open={showUnshareAll} onOpenChange={setShowUnshareAll}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("sharedLinks.unshareAllConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("sharedLinks.unshareAllConfirmDescription", {
                count: sharedChats.length,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isUnsharingAll}>
              {t("sharedLinks.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleUnshareAll}
              disabled={isUnsharingAll}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isUnsharingAll
                ? t("sharedLinks.unsharing")
                : t("sharedLinks.unshareAll")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export { SharedLinksTab };
