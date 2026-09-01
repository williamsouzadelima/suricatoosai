"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { SharedLinksTab } from "./SharedLinksTab";
import { X } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";

interface ManageSharedChatsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const ManageSharedChatsDialog = ({
  open,
  onOpenChange,
}: ManageSharedChatsDialogProps) => {
  const isMobile = useIsMobile();
  const t = useTranslations("dialogs");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[380px] max-w-[98%] md:w-[95vw] md:max-w-[720px] max-h-[95%] md:h-[600px] p-0 overflow-hidden rounded-[20px]"
        showCloseButton={!isMobile}
      >
        <DialogTitle className="sr-only">{t("manageShared.title")}</DialogTitle>

        {isMobile && (
          <div className="relative z-10 p-0">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <h3 className="text-lg font-semibold">
                {t("manageShared.title")}
              </h3>
              <button
                type="button"
                className="flex h-7 w-7 items-center justify-center cursor-pointer rounded-md hover:bg-muted"
                onClick={() => onOpenChange(false)}
                aria-label={t("manageShared.close")}
              >
                <X className="size-5" />
              </button>
            </div>
          </div>
        )}

        <div className="flex flex-col h-full min-h-0">
          {!isMobile && (
            <div className="gap-1 items-center px-6 py-5 flex self-stretch border-b">
              <h3 className="text-lg font-medium">{t("manageShared.title")}</h3>
            </div>
          )}
          <div className="flex-1 self-stretch items-start overflow-y-auto px-4 pt-4 pb-4 md:px-6 md:pt-4 min-h-0">
            <SharedLinksTab />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
