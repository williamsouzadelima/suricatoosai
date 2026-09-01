"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useGlobalState } from "@/app/contexts/GlobalState";
import { redirectToPricing } from "@/app/hooks/usePricingDialog";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { usePentestgptMigration } from "@/app/hooks/usePentestgptMigration";
import {
  CalendarClock,
  X,
  ChevronDown,
  Loader2,
  Sparkle,
  Undo2,
} from "lucide-react";
import {
  proFeatures,
  proPlusFeatures,
  ultraFeatures,
  teamFeatures,
} from "@/lib/pricing/features";
import DeleteAccountDialog from "./DeleteAccountDialog";
import CancelSubscriptionDialog from "./CancelSubscriptionDialog";
import {
  getSubscriptionCancellationStatus,
  keepSubscription,
  redirectToBillingPortal as openBillingPortal,
} from "@/lib/billing/client";
import type {
  BillingPortalFlow,
  SubscriptionCancellationStatus,
} from "@/lib/billing/api-types";
import type { SubscriptionTier } from "@/types";
import { PastDueBillingBanner } from "./PastDueBillingBanner";

type AccountCancellationStatus = SubscriptionCancellationStatus & {
  subscription: SubscriptionTier;
};

function formatCancellationDate(currentPeriodEnd?: number) {
  if (!currentPeriodEnd) return null;

  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(currentPeriodEnd));
}

const AccountTab = () => {
  const t = useTranslations("settings");
  const { subscription, setMigrateFromPentestgptDialogOpen } = useGlobalState();
  const [showDeleteAccount, setShowDeleteAccount] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [isKeepingPlan, setIsKeepingPlan] = useState(false);
  const [isOpeningBillingPortal, setIsOpeningBillingPortal] = useState(false);
  const [isTeamAdmin, setIsTeamAdmin] = useState<boolean | null>(null);
  const [cancellationStatus, setCancellationStatus] =
    useState<AccountCancellationStatus | null>(null);
  const { isMigrating } = usePentestgptMigration();

  // Fetch admin status for team subscriptions
  useEffect(() => {
    if (subscription === "team") {
      fetch("/api/team/members")
        .then((res) => res.json())
        .then((data) => setIsTeamAdmin(data.isAdmin ?? false))
        .catch(() => setIsTeamAdmin(false));
    }
  }, [subscription]);

  // For individual plans (pro/pro-plus/ultra), user always has billing access
  // For team plans, only admins can manage billing
  const canManageBilling =
    subscription === "pro" ||
    subscription === "pro-plus" ||
    subscription === "ultra" ||
    (subscription === "team" && isTeamAdmin === true);

  const currentPlanFeatures =
    subscription === "team"
      ? teamFeatures
      : subscription === "pro-plus"
        ? proPlusFeatures
        : proFeatures;
  const hasCurrentCancellationStatus =
    canManageBilling && cancellationStatus?.subscription === subscription;
  const currentCancellationStatus = hasCurrentCancellationStatus
    ? cancellationStatus
    : null;
  const cancellationEndDate = formatCancellationDate(
    currentCancellationStatus?.currentPeriodEnd,
  );
  const noActiveSubscription =
    currentCancellationStatus?.hasActiveSubscription === false;
  const cancellationScheduled =
    currentCancellationStatus?.cancelAtPeriodEnd === true;
  const pastDueStatus =
    currentCancellationStatus?.subscriptionStatus === "past_due"
      ? "past_due"
      : null;
  const isCheckingCancellationStatus =
    canManageBilling && !hasCurrentCancellationStatus;

  useEffect(() => {
    if (!canManageBilling || hasCurrentCancellationStatus) return;

    let ignore = false;

    getSubscriptionCancellationStatus()
      .then((status) => {
        if (!ignore) setCancellationStatus({ ...status, subscription });
      })
      .catch((error) => {
        if (!ignore) {
          console.warn(
            "Failed to load subscription cancellation status",
            error,
          );
          setCancellationStatus({
            subscription,
            hasActiveSubscription: false,
            cancelAtPeriodEnd: false,
          });
        }
      });

    return () => {
      ignore = true;
    };
  }, [canManageBilling, hasCurrentCancellationStatus, subscription]);

  const redirectToBillingPortal = async (flow?: BillingPortalFlow) => {
    if (isOpeningBillingPortal) return;
    setIsOpeningBillingPortal(true);
    try {
      const url = await openBillingPortal(flow);
      window.location.href = url;
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("account.toastBillingPortalError"),
      );
      setIsOpeningBillingPortal(false);
    }
  };

  const handleCancelSubscription = () => {
    setShowCancelDialog(true);
  };

  const handleCancellationCompleted = ({
    cancelAtPeriodEnd,
    currentPeriodEnd,
  }: {
    cancelAtPeriodEnd: boolean;
    currentPeriodEnd?: number;
  }) => {
    setCancellationStatus({
      subscription,
      hasActiveSubscription: cancelAtPeriodEnd,
      cancelAtPeriodEnd,
      currentPeriodEnd: cancelAtPeriodEnd ? currentPeriodEnd : undefined,
    });
  };

  const handleKeepPlan = async () => {
    if (isKeepingPlan) return;

    setIsKeepingPlan(true);
    try {
      const result = await keepSubscription();
      setCancellationStatus({
        subscription,
        hasActiveSubscription: true,
        cancelAtPeriodEnd: result.cancelAtPeriodEnd,
        currentPeriodEnd: result.currentPeriodEnd,
      });
      toast.success(t("account.toastCancellationRemoved"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("account.toastKeepPlanError"),
      );
    } finally {
      setIsKeepingPlan(false);
    }
  };

  const handleOpenMigrateConfirm = () => {
    if (isMigrating) return;
    setMigrateFromPentestgptDialogOpen(true);
  };

  return (
    <div className="space-y-6 min-h-0">
      <div className="border-b py-2">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium">
              {subscription === "ultra"
                ? t("account.planUltra")
                : subscription === "team"
                  ? t("account.planTeam")
                  : subscription === "pro-plus"
                    ? t("account.planProPlus")
                    : subscription === "pro"
                      ? t("account.planPro")
                      : t("account.planGetPro")}
            </div>
          </div>
          {subscription !== "free" ? (
            canManageBilling ? (
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isKeepingPlan}
                  >
                    {isKeepingPlan ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>{t("account.keeping")}</span>
                      </>
                    ) : (
                      <>
                        <span>{t("account.manage")}</span>
                        <ChevronDown className="h-4 w-4" />
                      </>
                    )}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  {(subscription === "pro" || subscription === "pro-plus") && (
                    <>
                      <DropdownMenuItem
                        onClick={() =>
                          redirectToPricing({
                            surface: "account_tab_manage_menu",
                            source: "account_settings",
                            from_tier: subscription,
                            cta_text: "Upgrade plan",
                          })
                        }
                      >
                        <Sparkle className="h-4 w-4" />
                        <span>{t("account.upgradePlan")}</span>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                    </>
                  )}
                  {cancellationScheduled ? (
                    <>
                      <DropdownMenuItem disabled>
                        <CalendarClock className="h-4 w-4" />
                        <span>{t("account.cancellationScheduledMenu")}</span>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={handleKeepPlan}
                        disabled={isKeepingPlan}
                      >
                        {isKeepingPlan ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Undo2 className="h-4 w-4" />
                        )}
                        <span>{t("account.keepPlan")}</span>
                      </DropdownMenuItem>
                    </>
                  ) : noActiveSubscription ? (
                    <DropdownMenuItem disabled>
                      <CalendarClock className="h-4 w-4" />
                      <span>{t("account.noActiveSubscription")}</span>
                    </DropdownMenuItem>
                  ) : isCheckingCancellationStatus ? (
                    <DropdownMenuItem disabled>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>{t("account.checkingSubscription")}</span>
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={handleCancelSubscription}
                    >
                      <X className="h-4 w-4" />
                      <span>{t("account.cancelSubscription")}</span>
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null
          ) : (
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={() =>
                redirectToPricing({
                  surface: "account_tab",
                  source: "account_settings",
                  from_tier: subscription,
                  cta_text: "Upgrade",
                })
              }
            >
              {t("account.upgrade")}
            </Button>
          )}
        </div>

        {cancellationScheduled && (
          <div className="mt-3 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">
              {t("account.cancellationScheduledLabel")}
            </span>{" "}
            {cancellationEndDate
              ? t("account.planActiveUntil", { date: cancellationEndDate })
              : t("account.planActiveUntilPeriodEnd")}
          </div>
        )}

        {pastDueStatus && subscription !== "free" && (
          <div className="mt-3">
            <PastDueBillingBanner
              surface="account_settings"
              subscription={subscription}
              subscriptionStatus={pastDueStatus}
              latestInvoiceId={currentCancellationStatus?.latestInvoiceId}
              isOpening={isOpeningBillingPortal}
              onUpdatePayment={() =>
                void redirectToBillingPortal("payment_method")
              }
            />
          </div>
        )}

        <div className="mt-2 rounded-lg bg-transparent px-0">
          <span className="text-sm font-semibold inline-block pb-4">
            {subscription === "ultra"
              ? t("account.thanksUltra")
              : subscription === "team"
                ? t("account.thanksTeam")
                : subscription === "pro-plus"
                  ? t("account.thanksProPlus")
                  : subscription === "pro"
                    ? t("account.thanksPro")
                    : t("account.getEverythingFree")}
          </span>
          <ul className="mb-2 flex flex-col gap-5">
            {(subscription === "ultra"
              ? ultraFeatures
              : currentPlanFeatures
            ).map((feature, index) => (
              <li key={index} className="relative">
                <div className="flex justify-start gap-3.5">
                  <feature.icon className="h-5 w-5 shrink-0" />
                  <span className="font-normal">{feature.text}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {subscription === "free" && (
        <div className="border-b pb-6">
          <div className="flex items-center justify-between py-3">
            <div>
              <div className="font-medium">{t("account.migrateTitle")}</div>
              <div className="text-sm text-muted-foreground mt-1">
                {t("account.migrateDescription")}
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleOpenMigrateConfirm}
              disabled={isMigrating}
            >
              {isMigrating ? t("account.migrating") : t("account.migrate")}
            </Button>
          </div>
        </div>
      )}

      {subscription !== "free" && canManageBilling && (
        <div>
          <div className="space-y-4">
            <div className="flex items-center justify-between py-3">
              <div>
                <div className="font-medium">{t("account.payment")}</div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={
                  isOpeningBillingPortal || isCheckingCancellationStatus
                }
                onClick={() =>
                  void redirectToBillingPortal(
                    pastDueStatus ? "payment_method" : undefined,
                  )
                }
              >
                {pastDueStatus
                  ? t("account.updatePayment")
                  : t("account.manage")}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Account Section */}
      <div>
        <div className="flex items-center justify-between py-3">
          <div>
            <div className="font-medium">{t("account.deleteAccountTitle")}</div>
          </div>
          <Button
            type="button"
            data-testid="delete-account-button"
            variant="destructive"
            size="sm"
            onClick={() => setShowDeleteAccount(true)}
            aria-label={t("account.deleteAccountAria")}
          >
            {t("account.delete")}
          </Button>
        </div>
      </div>

      <DeleteAccountDialog
        open={showDeleteAccount}
        onOpenChange={setShowDeleteAccount}
      />

      <CancelSubscriptionDialog
        open={showCancelDialog}
        onOpenChange={setShowCancelDialog}
        onCancellationCompleted={handleCancellationCompleted}
      />
    </div>
  );
};

export { AccountTab };
