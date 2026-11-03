import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { redirectToPricing } from "../hooks/usePricingDialog";
import { openSettingsDialog } from "@/lib/utils/settings-dialog";
import type { ChatMode, SubscriptionTier } from "@/types";
import type { LimitCapReason } from "@/lib/limit-pressure";
import type { AgentRunSpendCapBasis } from "@/lib/chat/agent-run-spend-cap";
import {
  getExtraUsageLimitCta,
  getLimitTypeForCapReason,
  shouldShowUpgradeCta,
} from "@/lib/limit-pressure";
import {
  captureAddCreditCtaClick,
  captureAddCreditCtaImpression,
  captureUpgradeCtaImpression,
} from "@/lib/analytics/client";

type Translator = (
  key: string,
  values?: Record<string, string | number>,
) => string;

// Discriminated union for warning data
export type RateLimitWarningData =
  | {
      warningType: "sliding-window";
      remaining: number;
      resetTime: Date;
      mode: ChatMode;
      subscription: SubscriptionTier;
    }
  | {
      warningType: "token-bucket";
      bucketType: "monthly";
      remainingPercent: number;
      resetTime: Date;
      subscription: SubscriptionTier;
      severity?: "info" | "warning";
      usedDollars?: number;
      limitDollars?: number;
      capReason?: LimitCapReason;
      midStream?: boolean;
      cutOff?: boolean;
    }
  | {
      warningType: "extra-usage-active";
      bucketType: "monthly";
      resetTime: Date;
      subscription: SubscriptionTier;
      capReason?: LimitCapReason;
      midStream?: boolean;
    }
  | {
      warningType: "paid-daily-free-allowance";
      resetTime: Date;
      subscription: SubscriptionTier;
      mode: ChatMode;
      costLimitDollars: number;
    }
  | {
      warningType: "agent-run-spend-cap";
      resetTime: Date;
      subscription: "pro";
      mode: "agent";
      runCostDollars: number;
      runCapDollars: number;
      monthlyRemainingDollars: number;
      capBasis: AgentRunSpendCapBasis;
      premiumContinuationAllowed: boolean;
      midStream?: boolean;
    };

interface RateLimitWarningProps {
  data: RateLimitWarningData;
  onDismiss: () => void;
}

const formatTimeUntil = (t: Translator, resetTime: Date): string => {
  const now = new Date();
  const timeDiff = resetTime.getTime() - now.getTime();

  if (timeDiff <= 0) {
    return t("timeNow");
  }

  const daysUntil = Math.floor(timeDiff / (1000 * 60 * 60 * 24));
  const hoursUntil = Math.floor(
    (timeDiff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60),
  );
  const minutesUntil = Math.floor((timeDiff % (1000 * 60 * 60)) / (1000 * 60));

  if (daysUntil === 0 && hoursUntil === 0 && minutesUntil === 0) {
    return t("timeLessThanMinute");
  }
  if (daysUntil >= 1 && hoursUntil === 0) {
    return t("timeInDays", { days: daysUntil });
  }
  if (daysUntil >= 1) {
    return t("timeInDaysHours", { days: daysUntil, hours: hoursUntil });
  }
  if (hoursUntil === 0) {
    return t("timeInMinutes", { minutes: minutesUntil });
  }
  if (minutesUntil === 0) {
    return t("timeInHours", { hours: hoursUntil });
  }
  return t("timeInHoursMinutes", { hours: hoursUntil, minutes: minutesUntil });
};

const getMessage = (
  t: Translator,
  tMode: Translator,
  data: RateLimitWarningData,
  timeString: string,
): string => {
  if (data.warningType === "sliding-window") {
    if (data.remaining === 0) {
      return data.mode === "agent"
        ? t("slidingAgentExhausted")
        : t("slidingExhausted");
    }

    return t("slidingRemaining", { count: data.remaining });
  }

  if (data.warningType === "extra-usage-active") {
    return t("extraUsageActive", { time: timeString });
  }

  if (data.warningType === "paid-daily-free-allowance") {
    return t("paidAllowance", {
      mode: tMode(data.mode === "agent" ? "agent" : "ask"),
      amount: data.costLimitDollars.toFixed(2),
      time: timeString,
    });
  }

  if (data.warningType === "agent-run-spend-cap") {
    return t("agentRunSpendCap", {
      runCost: data.runCostDollars.toFixed(2),
      runCap: data.runCapDollars.toFixed(2),
    });
  }

  // Token bucket warning — show dollar amounts when available
  if (data.remainingPercent === 0) {
    if (data.cutOff) {
      if (data.subscription === "free") {
        return t("cutOffFree", { time: timeString });
      }
      if (data.capReason === "extra_usage_cap") {
        return t("cutOffExtraUsageCap", { time: timeString });
      }
      if (data.capReason === "paid_daily_free_allowance_cut_off") {
        return t("cutOffPaidAllowance", { time: timeString });
      }
      return t("cutOffDefault", { time: timeString });
    }
    if (data.subscription === "free") {
      return t("freeMonthlyExhausted", { time: timeString });
    }

    return t("monthlyExhausted", { time: timeString });
  }

  const usedPercent = 100 - data.remainingPercent;
  if (data.usedDollars !== undefined && data.limitDollars !== undefined) {
    return t("usedDollars", {
      used: data.usedDollars.toFixed(2),
      limit: data.limitDollars.toFixed(2),
      percent: usedPercent,
      time: timeString,
    });
  }

  return t("percentRemaining", {
    percent: data.remainingPercent,
    time: timeString,
  });
};

const getUpgradeCtaText = (
  t: Translator,
  data: RateLimitWarningData,
  limitType: string,
): string => {
  if (
    data.subscription === "free" &&
    (limitType === "daily_requests" || limitType === "free_monthly")
  ) {
    return t("keepGoing");
  }

  return t("upgradePlan");
};

const WARNING_STYLES = "bg-input-chat border-black/8 dark:border-border";

export const RateLimitWarning = ({
  data,
  onDismiss,
}: RateLimitWarningProps) => {
  const t = useTranslations("rateLimit");
  const tMode = useTranslations("chatMode");
  const capturedUpgradeImpressionRef = useRef(false);
  const capturedAddCreditImpressionRef = useRef(false);
  const timeString = formatTimeUntil(t, data.resetTime);
  const message = getMessage(t, tMode, data, timeString);
  const capReason =
    data.warningType === "sliding-window" ||
    data.warningType === "agent-run-spend-cap" ||
    data.warningType === "paid-daily-free-allowance"
      ? undefined
      : data.capReason;
  const extraUsageCta =
    data.warningType === "token-bucket"
      ? getExtraUsageLimitCta({
          subscription: data.subscription,
          capReason,
        })
      : null;
  const showUsageCta =
    data.warningType === "extra-usage-active" ||
    data.warningType === "paid-daily-free-allowance";
  const showUpgrade =
    data.warningType !== "agent-run-spend-cap" &&
    data.warningType !== "extra-usage-active" &&
    data.warningType !== "paid-daily-free-allowance" &&
    shouldShowUpgradeCta({
      subscription: data.subscription,
      capReason,
    });
  const limitType =
    data.warningType === "sliding-window"
      ? "daily_requests"
      : data.warningType === "agent-run-spend-cap"
        ? "monthly"
        : data.warningType === "paid-daily-free-allowance"
          ? "paid_daily_free_allowance"
          : data.warningType === "token-bucket"
            ? getLimitTypeForCapReason(capReason)
            : getLimitTypeForCapReason(data.capReason ?? "extra_usage_active");
  const limitSeverity =
    data.warningType === "token-bucket" && data.remainingPercent === 0
      ? "hit"
      : "warning";
  const upgradeCtaText = getUpgradeCtaText(t, data, limitType);

  useEffect(() => {
    if (!showUpgrade || capturedUpgradeImpressionRef.current) return;
    capturedUpgradeImpressionRef.current = true;
    captureUpgradeCtaImpression({
      surface: "rate_limit_warning",
      source: "limit_pressure",
      from_tier: data.subscription,
      limit_type: limitType,
      limit_severity: limitSeverity,
      cap_reason: capReason,
      cta_text: upgradeCtaText,
    });
  }, [
    capReason,
    data.subscription,
    limitSeverity,
    limitType,
    showUpgrade,
    upgradeCtaText,
  ]);

  useEffect(() => {
    if (!extraUsageCta || capturedAddCreditImpressionRef.current) return;
    capturedAddCreditImpressionRef.current = true;
    captureAddCreditCtaImpression({
      surface: "rate_limit_warning",
      source: "limit_pressure",
      from_tier: data.subscription,
      limit_type: limitType,
      limit_severity: limitSeverity,
      cap_reason: capReason,
      cta_text: extraUsageCta.analyticsText,
    });
  }, [capReason, data.subscription, extraUsageCta, limitSeverity, limitType]);

  return (
    <div
      data-testid="rate-limit-warning"
      className={`mb-2 px-3 py-2.5 border rounded-[22px] flex items-center justify-between gap-2 ${WARNING_STYLES}`}
    >
      <div className="flex-1 flex items-center gap-2 flex-wrap">
        <span className="text-foreground text-sm">{message}</span>
        {extraUsageCta && (
          <Button
            onClick={() => {
              captureAddCreditCtaClick({
                surface: "rate_limit_warning",
                source: "limit_pressure",
                from_tier: data.subscription,
                limit_type: limitType,
                limit_severity: limitSeverity,
                cap_reason: capReason,
                cta_text: extraUsageCta.analyticsText,
              });
              openSettingsDialog(extraUsageCta.settingsTab);
            }}
            size="sm"
            variant={
              extraUsageCta.analyticsText === "Add Credits"
                ? "default"
                : "outline"
            }
            className="h-7 px-3 text-xs font-medium border-black/8 dark:border-border"
          >
            {extraUsageCta.label}
          </Button>
        )}
        {showUsageCta && (
          <Button
            onClick={() => openSettingsDialog("Usage")}
            size="sm"
            variant="outline"
            className="h-7 px-3 text-xs font-medium border-black/8 dark:border-border"
          >
            {t("viewUsage")}
          </Button>
        )}
        {showUpgrade && (
          <Button
            onClick={() =>
              redirectToPricing({
                surface: "rate_limit_warning",
                source: "limit_pressure",
                from_tier: data.subscription,
                limit_type: limitType,
                reason: capReason,
                cta_text: upgradeCtaText,
              })
            }
            size="sm"
            variant="outline"
            className="h-7 px-3 text-xs font-medium border-black/8 dark:border-border"
          >
            {upgradeCtaText}
          </Button>
        )}
      </div>
      <button
        onClick={onDismiss}
        className="flex-shrink-0 text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
        aria-label={t("dismiss")}
      >
        <X className="h-5 w-5" />
      </button>
    </div>
  );
};
