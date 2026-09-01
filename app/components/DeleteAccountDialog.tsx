"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useAuth } from "@workos-inc/authkit-nextjs/components";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Lock, TriangleAlert } from "lucide-react";
import {
  ACCOUNT_CLEANUP_IN_PROGRESS_CODE,
  MAX_ACCOUNT_CLEANUP_REQUESTS,
} from "@/lib/account-deletion";

type DeleteAccountDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type DeleteAccountResponse = {
  code?: string;
  error?: string;
};

async function requestAccountDeletion() {
  for (let attempt = 0; attempt < MAX_ACCOUNT_CLEANUP_REQUESTS; attempt++) {
    const response = await fetch("/api/delete-account", { method: "POST" });
    const data = (await response
      .json()
      .catch(() => ({}))) as DeleteAccountResponse;

    if (
      response.status === 409 &&
      data.code === ACCOUNT_CLEANUP_IN_PROGRESS_CODE
    ) {
      continue;
    }

    if (!response.ok) {
      throw new Error(data.error || "Failed to delete account");
    }

    return;
  }

  throw new Error(
    "Account cleanup is still in progress after the bounded retry window",
  );
}

export const DeleteAccountDialog = ({
  open,
  onOpenChange,
}: DeleteAccountDialogProps) => {
  const { user } = useAuth();
  const t = useTranslations("dialogs");
  const [isDeleting, setIsDeleting] = useState(false);
  const [emailInput, setEmailInput] = useState("");
  const [confirmInput, setConfirmInput] = useState("");

  const lastSignInAtIso: string | null = useMemo(() => {
    if (!user) return null;
    // WorkOS user has lastSignInAt ISO string when available

    const value = (user as any)?.lastSignInAt as string | undefined;
    return value ?? null;
  }, [user]);

  const hasRecentLogin = useMemo(() => {
    if (!lastSignInAtIso) return false;
    const last = new Date(lastSignInAtIso).getTime();
    if (Number.isNaN(last)) return false;
    const tenMinutesMs = 10 * 60 * 1000;
    return Date.now() - last <= tenMinutesMs;
  }, [lastSignInAtIso]);

  const expectedEmail: string = useMemo(() => user?.email ?? "", [user]);

  const emailMatches = useMemo(() => {
    if (!expectedEmail) return false;
    return emailInput.trim().toLowerCase() === expectedEmail.toLowerCase();
  }, [emailInput, expectedEmail]);

  const phraseMatches = useMemo(
    () => confirmInput.trim() === "DELETE",
    [confirmInput],
  );

  const canDelete =
    hasRecentLogin && emailMatches && phraseMatches && !isDeleting;

  useEffect(() => {
    if (open) return;
    setEmailInput("");
    setConfirmInput("");
  }, [open]);

  const handleRefreshLogin = async () => {
    const { clientLogout } = await import("@/lib/utils/logout");
    clientLogout();
  };

  const handleConfirmDelete = async () => {
    if (isDeleting || !canDelete) return;
    setIsDeleting(true);
    try {
      // Delete Convex data, cancel Stripe subs, remove WorkOS org(s), and
      // delete the WorkOS user server-side.
      await requestAccountDeletion();
      // Clear HttpOnly auth cookies on the server, then redirect home
      try {
        await fetch("/api/clear-auth-cookies", { method: "POST" });
      } catch {}
      try {
        sessionStorage.clear();
        localStorage.clear();
      } catch {}
      window.location.replace("/");
    } catch (error) {
      console.error("Failed to delete user data:", error);
      toast.error(t("deleteAccount.deleteError"));
      setIsDeleting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} modal={true}>
      <DialogContent
        data-testid="delete-account-dialog"
        className="sm:max-w-md max-h-[90vh] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>{t("deleteAccount.title")}</DialogTitle>
        </DialogHeader>
        <DialogDescription
          data-testid="delete-account-description"
          className="pt-2 text-sm text-foreground"
        >
          {t("deleteAccount.description")}
        </DialogDescription>

        {!hasRecentLogin && (
          <p className="text-xs pt-4 text-muted-foreground">
            {t("deleteAccount.recentLoginWarning")}
          </p>
        )}

        {hasRecentLogin && (
          <div className="pt-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="delete-email">
                {t("deleteAccount.emailLabel")}
              </Label>
              <Input
                data-testid="email-confirmation"
                id="delete-email"
                type="email"
                inputMode="email"
                aria-label={t("deleteAccount.emailAria")}
                placeholder={expectedEmail || "name@example.com"}
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                aria-invalid={Boolean(emailInput) && !emailMatches}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="delete-confirm">
                {t("deleteAccount.confirmLabel")}
              </Label>
              <Input
                data-testid="delete-phrase-input"
                id="delete-confirm"
                aria-label={t("deleteAccount.confirmAria")}
                placeholder="DELETE"
                value={confirmInput}
                onChange={(e) => setConfirmInput(e.target.value)}
                aria-invalid={
                  Boolean(confirmInput) && confirmInput.trim() !== "DELETE"
                }
              />
            </div>
          </div>
        )}

        <DialogFooter data-testid="delete-account-footer" className="pt-4">
          {!hasRecentLogin ? (
            <Button
              type="button"
              data-testid="refresh-login-button"
              variant="outline"
              onClick={handleRefreshLogin}
              className="w-full"
            >
              {t("deleteAccount.refreshLogin")}
            </Button>
          ) : (
            <Button
              type="button"
              data-testid="delete-button"
              variant="destructive"
              onClick={handleConfirmDelete}
              disabled={!canDelete}
              className="w-full"
            >
              {isDeleting ? (
                <Loader2 aria-hidden="true" className="size-4 animate-spin" />
              ) : canDelete ? (
                <TriangleAlert aria-hidden="true" className="size-4" />
              ) : (
                <Lock aria-hidden="true" className="size-4" />
              )}
              {isDeleting
                ? t("deleteAccount.deleting")
                : t("deleteAccount.deleteButton")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default DeleteAccountDialog;
