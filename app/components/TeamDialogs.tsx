"use client";

import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Plus, Minus } from "lucide-react";
import { useTranslations } from "next-intl";

interface TeamMember {
  id: string;
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  createdAt: string;
  isCurrentUser: boolean;
}

interface PendingInvitation {
  id: string;
  email: string;
  role: string;
  invitedAt: string;
  expiresAt: string;
}

interface TeamDialogsProps {
  // Invite dialog props
  showInviteDialog: boolean;
  setShowInviteDialog: (show: boolean) => void;
  inviteEmail: string;
  setInviteEmail: (email: string) => void;
  inviting: boolean;
  handleInvite: (e: React.FormEvent) => void;

  // Remove member dialog props
  memberToRemove: TeamMember | null;
  setMemberToRemove: (member: TeamMember | null) => void;
  removing: string | null;
  handleRemove: () => void;

  // Revoke invitation dialog props
  inviteToRevoke: PendingInvitation | null;
  setInviteToRevoke: (invitation: PendingInvitation | null) => void;
  revokingInvite: string | null;
  handleRevokeInvite: () => void;

  // Leave team dialog props
  showLeaveDialog: boolean;
  setShowLeaveDialog: (show: boolean) => void;
  leaving: boolean;
  handleLeaveTeam: () => void;
}

export const TeamDialogs = ({
  showInviteDialog,
  setShowInviteDialog,
  inviteEmail,
  setInviteEmail,
  inviting,
  handleInvite,
  memberToRemove,
  setMemberToRemove,
  removing,
  handleRemove,
  inviteToRevoke,
  setInviteToRevoke,
  revokingInvite,
  handleRevokeInvite,
  showLeaveDialog,
  setShowLeaveDialog,
  leaving,
  handleLeaveTeam,
}: TeamDialogsProps) => {
  const t = useTranslations("dialogs");
  return (
    <>
      {/* Invite Member Dialog */}
      <Dialog
        open={showInviteDialog}
        onOpenChange={(open) => {
          setShowInviteDialog(open);
          if (!open) {
            setInviteEmail("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("team.inviteTitle")}</DialogTitle>
            <DialogDescription>{t("team.inviteDescription")}</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleInvite}>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <label htmlFor="email" className="text-sm font-medium">
                  {t("team.emailLabel")}
                </label>
                <Input
                  id="email"
                  type="email"
                  placeholder={t("team.emailPlaceholder")}
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  disabled={inviting}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setShowInviteDialog(false);
                  setInviteEmail("");
                }}
                disabled={inviting}
              >
                {t("team.cancel")}
              </Button>
              <Button type="submit" disabled={inviting}>
                {inviting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    {t("team.sending")}
                  </>
                ) : (
                  t("team.sendInvite")
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Remove Member Confirmation Dialog */}
      <Dialog
        open={!!memberToRemove}
        onOpenChange={(open) => !open && setMemberToRemove(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("team.removeTitle")}</DialogTitle>
            <DialogDescription>
              {t.rich("team.removeDescription", {
                email: memberToRemove?.email ?? "",
                b: (chunks) => (
                  <span className="font-medium text-foreground">{chunks}</span>
                ),
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setMemberToRemove(null)}
              disabled={removing === memberToRemove?.id}
            >
              {t("team.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleRemove}
              disabled={removing === memberToRemove?.id}
            >
              {removing === memberToRemove?.id ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  {t("team.removing")}
                </>
              ) : (
                t("team.removeButton")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Revoke Invitation Confirmation Dialog */}
      <Dialog
        open={!!inviteToRevoke}
        onOpenChange={(open) => !open && setInviteToRevoke(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("team.revokeTitle")}</DialogTitle>
            <DialogDescription>
              {t.rich("team.revokeDescription", {
                email: inviteToRevoke?.email ?? "",
                b: (chunks) => (
                  <span className="font-medium text-foreground">{chunks}</span>
                ),
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setInviteToRevoke(null)}
              disabled={revokingInvite === inviteToRevoke?.id}
            >
              {t("team.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleRevokeInvite}
              disabled={revokingInvite === inviteToRevoke?.id}
            >
              {revokingInvite === inviteToRevoke?.id ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  {t("team.revoking")}
                </>
              ) : (
                t("team.revokeButton")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Decrease Seats Dialog - Removed, now using ManageSeatsDialog in TeamTab */}

      {/* Leave Team Dialog */}
      <Dialog
        open={showLeaveDialog}
        onOpenChange={(open) => !open && setShowLeaveDialog(false)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("team.leaveTitle")}</DialogTitle>
            <DialogDescription>{t("team.leaveDescription")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowLeaveDialog(false)}
              disabled={leaving}
            >
              {t("team.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleLeaveTeam}
              disabled={leaving}
            >
              {leaving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  {t("team.leaving")}
                </>
              ) : (
                t("team.leaveButton")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export const TeamWelcomeDialog = ({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const t = useTranslations("dialogs");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("team.welcomeTitle")}</DialogTitle>
          <DialogDescription>{t("team.welcomeDescription")}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>{t("team.gotIt")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

interface SeatPreview {
  currentQuantity: number;
  newQuantity: number;
  seatsDelta: number;
  proratedCharge: number;
  proratedCredit: number;
  totalDue: number;
  pricePerSeat: number;
  proratedPerSeat: number;
  paymentMethod: string;
  currentPeriodEnd: number;
  nextInvoiceAmount: number;
  isIncrease: boolean;
  isYearly: boolean;
  totalUsed: number;
}

const formatUnixDate = (ts?: number) =>
  typeof ts === "number" && Number.isFinite(ts) && ts > 0
    ? new Date(ts * 1000).toLocaleDateString()
    : "";

export const ManageSeatsDialog = ({
  open,
  onOpenChange,
  currentSeats,
  totalUsedSeats,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentSeats: number;
  totalUsedSeats: number;
  onSuccess: () => void;
}) => {
  const t = useTranslations("dialogs");
  const [targetSeats, setTargetSeats] = useState(currentSeats);
  const [preview, setPreview] = useState<SeatPreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");

  const seatsDelta = targetSeats - currentSeats;
  const isIncrease = seatsDelta > 0;
  const isDecrease = seatsDelta < 0;
  const maxSeats = 999;
  const minSeats = Math.max(2, totalUsedSeats);

  // Fetch preview when dialog opens or targetSeats changes
  useEffect(() => {
    if (!open || targetSeats === currentSeats) {
      setPreview(null);
      return;
    }

    const fetchPreview = async () => {
      setLoadingPreview(true);
      setError("");
      try {
        const res = await fetch("/api/team/seats", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ quantity: targetSeats }),
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Failed to fetch preview");
        }

        const data = await res.json();
        setPreview(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load preview");
        setPreview(null);
      } finally {
        setLoadingPreview(false);
      }
    };

    const debounce = setTimeout(fetchPreview, 300);
    return () => clearTimeout(debounce);
  }, [open, targetSeats, currentSeats]);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setTargetSeats(currentSeats);
      setError("");
      setPreview(null);
    }
  }, [open, currentSeats]);

  const handleConfirm = async () => {
    setConfirming(true);
    setError("");

    try {
      const res = await fetch("/api/team/seats", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantity: targetSeats }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to update seats");
      }

      if (data.success) {
        onOpenChange(false);
        onSuccess();
      } else if (data.requiresPayment && data.invoiceUrl) {
        window.location.href = data.invoiceUrl;
      } else {
        throw new Error(data.message || "Failed to update seats");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update seats");
    } finally {
      setConfirming(false);
    }
  };

  const getButtonText = () => {
    if (confirming) return null;
    if (!preview || seatsDelta === 0) return t("team.selectSeatCount");

    if (isIncrease) {
      return t("team.addSeats", {
        count: seatsDelta,
        amount: preview.totalDue.toFixed(2),
      });
    } else {
      return t("team.removeSeats", {
        count: Math.abs(seatsDelta),
        amount: preview.proratedCredit.toFixed(2),
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{t("team.manageTitle")}</DialogTitle>
          <DialogDescription>{t("team.manageDescription")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Seat Selector */}
          <div className="space-y-2">
            <label className="text-sm font-medium">
              {t("team.numberOfSeats")}
            </label>
            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() =>
                  setTargetSeats(Math.max(minSeats, targetSeats - 1))
                }
                disabled={targetSeats <= minSeats || confirming}
              >
                <Minus className="h-4 w-4" />
              </Button>
              <Input
                type="number"
                min={minSeats}
                max={maxSeats}
                value={targetSeats}
                onChange={(e) => {
                  const val = parseInt(e.target.value) || currentSeats;
                  setTargetSeats(Math.min(maxSeats, Math.max(minSeats, val)));
                }}
                className="w-24 text-center"
                disabled={confirming}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() =>
                  setTargetSeats(Math.min(maxSeats, targetSeats + 1))
                }
                disabled={targetSeats >= maxSeats || confirming}
              >
                <Plus className="h-4 w-4" />
              </Button>
              <span className="text-sm text-muted-foreground">
                {seatsDelta === 0
                  ? t("team.seatsNoChange", { count: currentSeats })
                  : isIncrease
                    ? t("team.seatsNew", { count: seatsDelta })
                    : t("team.seatsFewer", { count: seatsDelta })}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("team.currentlyUsing", {
                used: totalUsedSeats,
                total: currentSeats,
              })}
            </p>
          </div>

          {/* Preview Section */}
          {loadingPreview ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : preview && seatsDelta !== 0 ? (
            <div className="space-y-4 rounded-lg border p-4">
              <div className="flex justify-between text-sm">
                <span>
                  {isIncrease
                    ? t("team.additionalSeats")
                    : t("team.seatsToRemove")}
                </span>
                <span className="font-medium">
                  {isIncrease ? `+${seatsDelta}` : seatsDelta}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span>
                  {isIncrease
                    ? t("team.proratedCharge")
                    : t("team.proratedCredit")}
                  <span className="text-muted-foreground ml-1">
                    {t("team.perSeat", {
                      amount: preview.proratedPerSeat.toFixed(2),
                    })}
                  </span>
                </span>
                <span
                  className={`font-medium ${isDecrease ? "text-green-600" : ""}`}
                >
                  {isIncrease
                    ? `$${preview.proratedCharge.toFixed(2)}`
                    : `+$${preview.proratedCredit.toFixed(2)}`}
                </span>
              </div>
              <div className="border-t pt-3 flex justify-between">
                <span className="font-medium">
                  {isIncrease
                    ? t("team.totalDueToday")
                    : t("team.creditToAccount")}
                </span>
                <span
                  className={`font-semibold text-lg ${isDecrease ? "text-green-600" : ""}`}
                >
                  {isIncrease
                    ? `$${preview.totalDue.toFixed(2)}`
                    : `+$${preview.proratedCredit.toFixed(2)}`}
                </span>
              </div>
              {preview.paymentMethod && isIncrease && (
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>{t("team.paymentMethod")}</span>
                  <span>{preview.paymentMethod}</span>
                </div>
              )}
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>
                  {t("team.nextInvoice")}
                  {formatUnixDate(preview.currentPeriodEnd) &&
                    ` (${formatUnixDate(preview.currentPeriodEnd)})`}
                </span>
                <span>${preview.nextInvoiceAmount.toFixed(2)}</span>
              </div>
            </div>
          ) : null}

          {/* Error Message */}
          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 rounded-md">
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={confirming}
          >
            {t("team.cancel")}
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={
              confirming || loadingPreview || !preview || seatsDelta === 0
            }
          >
            {confirming ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                {t("team.processing")}
              </>
            ) : (
              getButtonText()
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
