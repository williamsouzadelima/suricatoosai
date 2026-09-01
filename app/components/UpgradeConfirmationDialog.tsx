"use client";

import React, { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { X } from "lucide-react";
import { Loader2 } from "lucide-react";
import {
  getPostHogRequestHeaders,
  newCheckoutAttemptId,
} from "@/lib/analytics/client";

interface UpgradeConfirmationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  planName: string;
  price: number;
  targetPlan: string;
  quantity?: number;
  source?: string;
  surface?: string;
  reason?: string;
  limitType?: string;
}

// Safely validate and format unix seconds into a display date
const isValidUnix = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

const formatUnixDate = (ts?: number) =>
  isValidUnix(ts) ? new Date(ts * 1000).toLocaleDateString() : "";

interface SubscriptionDetails {
  paymentMethod: string;
  currentPlan: string;
  proratedAmount: number;
  proratedCredit: number;
  totalDue: number;
  currentPeriodStart?: number;
  currentPeriodEnd?: number;
  nextInvoiceDate?: number;
  nextInvoiceAmount?: number;
  quantity?: number;
}

const UpgradeConfirmationDialog: React.FC<UpgradeConfirmationDialogProps> = ({
  isOpen,
  onClose,
  planName,
  price,
  targetPlan,
  quantity,
  source,
  surface,
  reason,
  limitType,
}) => {
  const t = useTranslations("pricing");
  const [details, setDetails] = useState<SubscriptionDetails | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string>("");
  const [checkoutAttemptId, setCheckoutAttemptId] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (!isOpen) {
      setCheckoutAttemptId(null);
      return;
    }

    setCheckoutAttemptId(newCheckoutAttemptId());
  }, [isOpen, targetPlan]);

  useEffect(() => {
    const fetchDetails = async () => {
      if (!isOpen || !checkoutAttemptId) return;

      setLoadingDetails(true);
      setError("");
      try {
        // Single API call: preview + current details in one response
        const previewRes = await fetch("/api/subscription-details", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...getPostHogRequestHeaders(),
          },
          body: JSON.stringify({
            plan: targetPlan,
            confirm: false,
            quantity: quantity,
            checkoutAttemptId,
            source,
            surface,
            reason,
            limitType,
          }),
        });

        const previewData = await previewRes.json().catch(() => ({}));
        if (!previewRes.ok) {
          setError(previewData.error || t("upgradeConfirm.failedPreview"));
          return;
        }

        setDetails({
          paymentMethod: previewData.paymentMethod,
          currentPlan: previewData.currentPlan,
          proratedAmount: previewData.proratedAmount ?? price,
          proratedCredit: previewData.proratedCredit,
          totalDue: previewData.totalDue,
          // @ts-expect-error - backend may not send this on older versions
          additionalCredit: previewData.additionalCredit || 0,
          currentPeriodStart: previewData.currentPeriodStart,
          currentPeriodEnd: previewData.currentPeriodEnd,
          nextInvoiceDate: previewData.nextInvoiceDate,
          nextInvoiceAmount: previewData.nextInvoiceAmount,
          quantity: previewData.quantity,
        });
      } catch (error) {
        console.error("Error fetching subscription details:", error);
        // Set fallback values
        setDetails({
          paymentMethod: t("upgradeConfirm.paymentMethodOnFile"),
          currentPlan: t("upgradeConfirm.currentFallback"),
          proratedAmount: price,
          proratedCredit: 0,
          totalDue: price,
        });
      } finally {
        setLoadingDetails(false);
      }
    };

    fetchDetails();
  }, [
    isOpen,
    targetPlan,
    price,
    quantity,
    checkoutAttemptId,
    source,
    surface,
    reason,
    limitType,
  ]);

  const proratedCredit = details?.proratedCredit || 0;
  const additionalCredit = (details as any)?.additionalCredit || 0;
  const totalDue = details?.totalDue ?? price;
  const canConfirm = Boolean(checkoutAttemptId && details);

  const handleConfirmPayment = async () => {
    if (!checkoutAttemptId || !details) {
      setError(t("upgradeConfirm.stillPreparing"));
      return;
    }

    setConfirming(true);
    setError("");
    try {
      const response = await fetch("/api/subscription-details", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getPostHogRequestHeaders(),
        },
        body: JSON.stringify({
          plan: targetPlan,
          confirm: true,
          quantity: quantity,
          checkoutAttemptId,
          source,
          surface,
          reason,
          limitType,
          fromTier: details.currentPlan,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        // Handle error without throwing (cleaner console)
        setError(result.error || t("upgradeConfirm.failedUpdate"));
        setConfirming(false);
        return;
      }

      if (result.success) {
        // Subscription updated successfully
        onClose();

        // Redirect with refresh=entitlements to trigger entitlement sync
        setTimeout(() => {
          const url = new URL(window.location.href);
          url.searchParams.set("refresh", "entitlements");
          url.hash = ""; // Remove #pricing hash if present
          window.location.href = url.toString();
        }, 500);
      } else if (result.requiresPayment && result.invoiceUrl) {
        // Payment failed, redirect to invoice payment page
        window.location.href = result.invoiceUrl;
      } else {
        setError(result.message || t("upgradeConfirm.failedUpdate"));
        setConfirming(false);
      }
    } catch (error) {
      console.error("Error confirming payment:", error);
      setError(
        error instanceof Error
          ? error.message
          : t("upgradeConfirm.failedUpdateRetry"),
      );
      setConfirming(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent
        className="!max-w-[600px] !w-[90vw] sm:!w-full !max-h-[90vh] overflow-y-auto"
        showCloseButton={false}
      >
        <div className="flex items-center justify-between mb-6">
          <DialogTitle className="text-2xl font-semibold">
            {t("upgradeConfirm.confirmPlanChanges")}
          </DialogTitle>
          <button
            onClick={onClose}
            className="text-foreground opacity-50 transition hover:opacity-75"
            aria-label={t("upgradeConfirm.closeDialog")}
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        <div className="space-y-6">
          {loadingDetails ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {/* Plan Details */}
              <div className="flex items-center justify-between pb-4 border-b">
                <div>
                  <div className="text-lg font-medium">
                    {t("upgradeConfirm.subscriptionLabel", { planName })}
                    {details?.quantity && details.quantity > 1 && (
                      <span className="text-muted-foreground font-normal">
                        {" "}
                        {t("upgradeConfirm.seatsCount", {
                          count: details.quantity,
                        })}
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-muted-foreground mt-1">
                    {t("upgradeConfirm.proratedCharge")}
                  </div>
                  {isValidUnix(details?.currentPeriodStart) &&
                    isValidUnix(details?.currentPeriodEnd) && (
                      <div className="text-xs text-muted-foreground mt-1">
                        {t("upgradeConfirm.currentPeriod", {
                          start: formatUnixDate(details.currentPeriodStart),
                          end: formatUnixDate(details.currentPeriodEnd),
                        })}
                      </div>
                    )}
                </div>
                <div className="text-lg font-semibold">
                  ${(details?.proratedAmount ?? price).toFixed(2)}
                </div>
              </div>

              {/* Adjustment - only show if there's a prorated credit */}
              {proratedCredit > 0 && (
                <div className="flex items-start justify-between pb-4 border-b">
                  <div>
                    <div className="text-lg font-medium">
                      {t("upgradeConfirm.prorationCredit")}
                    </div>
                    <div className="text-sm text-muted-foreground mt-1">
                      {t("upgradeConfirm.creditUnusedTime", {
                        plan:
                          details?.currentPlan ||
                          t("upgradeConfirm.currentFallback"),
                      })}
                    </div>
                  </div>
                  <div className="text-lg font-semibold text-green-600">
                    -${proratedCredit.toFixed(2)}
                  </div>
                </div>
              )}

              {/* Additional credit to balance */}
              {additionalCredit > 0 && (
                <div className="flex items-start justify-between pb-4 border-b">
                  <div>
                    <div className="text-lg font-medium">
                      {t("upgradeConfirm.creditToBalance")}
                    </div>
                    <div className="text-sm text-muted-foreground mt-1">
                      {t("upgradeConfirm.excessCredit")}
                    </div>
                  </div>
                  <div className="text-lg font-semibold text-green-600">
                    -${additionalCredit.toFixed(2)}
                  </div>
                </div>
              )}

              {/* Total */}
              <div className="flex items-center justify-between pb-6 border-b">
                <div className="text-xl font-semibold">
                  {t("upgradeConfirm.totalDueToday")}
                </div>
                <div className="text-xl font-semibold">
                  ${totalDue.toFixed(2)}
                </div>
              </div>

              {/* Next Invoice Estimate */}
              {isValidUnix(details?.nextInvoiceDate) &&
                typeof details?.nextInvoiceAmount === "number" && (
                  <div className="flex items-center justify-between pb-6 border-b">
                    <div>
                      <div className="text-base font-medium">
                        {t("upgradeConfirm.nextInvoiceOn", {
                          date: formatUnixDate(details.nextInvoiceDate),
                        })}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {t("upgradeConfirm.estimateNote")}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {t("upgradeConfirm.fullUsageRenews")}
                      </div>
                    </div>
                    <div className="text-base font-semibold">
                      ${Number(details.nextInvoiceAmount).toFixed(2)}
                    </div>
                  </div>
                )}

              {/* Payment Method */}
              {details?.paymentMethod && (
                <div className="flex items-center justify-between pb-6 border-b">
                  <div className="text-base font-medium">
                    {t("upgradeConfirm.paymentMethod")}
                  </div>
                  <div className="text-base">{details.paymentMethod}</div>
                </div>
              )}
            </>
          )}

          {/* Error Message */}
          {error && (
            <div className="p-4 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 rounded-lg">
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <Button
              variant="outline"
              size="lg"
              onClick={onClose}
              disabled={confirming || loadingDetails}
              className="px-8"
            >
              {t("upgradeConfirm.cancel")}
            </Button>
            <Button
              variant="default"
              size="lg"
              onClick={handleConfirmPayment}
              disabled={confirming || loadingDetails || !canConfirm}
              className="px-8"
            >
              {confirming ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t("upgradeConfirm.processing")}
                </>
              ) : (
                t("upgradeConfirm.confirmAndPay")
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default UpgradeConfirmationDialog;
