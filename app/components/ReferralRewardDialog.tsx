"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  ArrowLeft,
  Check,
  Coins,
  Copy,
  Gift,
  Link as LinkIcon,
  UserPlus,
  Zap,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { captureAuthenticatedEvent } from "@/lib/analytics/client";

type ReferralProgram = {
  code: string;
  active: boolean;
  referralUrl: string;
  referrerSubscriptionTier: string;
  referrerRewardDollars: number;
  referredSignupBonusUnits: number;
  stats: {
    attributedSignups: number;
    paidConversions: number;
    awardedDollars: number;
  };
};

type ReferralRewardDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ReferralRewardDialog({
  open,
  onOpenChange,
}: ReferralRewardDialogProps) {
  const t = useTranslations("dialogs");
  const [program, setProgram] = React.useState<ReferralProgram | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [view, setView] = React.useState<"main" | "guidelines">("main");

  React.useEffect(() => {
    if (!open) {
      setView("main");
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);
    setCopied(false);

    fetch("/api/referrals", { credentials: "include" })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(body.error || t("referral.loadLinkError"));
        }
        return body as ReferralProgram;
      })
      .then((body) => {
        if (cancelled) return;
        setProgram(body);
        captureAuthenticatedEvent("referral_modal_opened", {
          referral_code: body.code,
          referrer_subscription_tier: body.referrerSubscriptionTier,
          referrer_reward_dollars: body.referrerRewardDollars,
          referred_signup_bonus_units: body.referredSignupBonusUnits,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : t("referral.loadError"));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  const copyLink = async () => {
    if (!program?.referralUrl || !program.active) return;

    try {
      await navigator.clipboard.writeText(program.referralUrl);
      setCopied(true);
      toast.success(t("referral.linkCopied"));
      captureAuthenticatedEvent("referral_link_copied", {
        referral_code: program.code,
        referrer_subscription_tier: program.referrerSubscriptionTier,
      });
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error(t("referral.copyError"));
    }
  };

  const referrerReward = program?.referrerRewardDollars ?? 0;
  const referrerRewardTitle = t("referral.rewardTitle", {
    amount: referrerReward,
  });
  const referrerRewardCopy = t.rich("referral.rewardCopy", {
    amount: referrerReward,
    b: (chunks) => <b>{chunks}</b>,
  });
  const referredSignupBonusUnits = program?.referredSignupBonusUnits ?? 0;
  const referredSignupBonusCopy = t("referral.signupBonus", {
    count: referredSignupBonusUnits,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[95vh] max-w-lg flex-col gap-4 overflow-y-auto rounded-3xl p-6">
        {view === "guidelines" ? (
          <>
            <DialogHeader className="flex flex-col gap-4 text-left sm:text-left">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-foreground w-fit gap-1 px-2"
                onClick={() => setView("main")}
              >
                <ArrowLeft className="size-4" />
                {t("referral.back")}
              </Button>
              <DialogTitle className="text-lg leading-none font-medium">
                {t("referral.guidelinesTitle")}
              </DialogTitle>
              <DialogDescription className="sr-only">
                {t("referral.guidelinesSrDescription")}
              </DialogDescription>
            </DialogHeader>

            <div className="pb-6">
              <ul className="flex list-disc flex-col gap-2 px-5">
                <li>
                  <span className="text-muted-foreground text-sm">
                    {t("referral.guideline1")}
                  </span>
                </li>
                <li>
                  <span className="text-muted-foreground text-sm">
                    {t("referral.guideline2")}
                  </span>
                </li>
                <li>
                  <span className="text-muted-foreground text-sm">
                    {t("referral.guideline3")}
                  </span>
                </li>
                <li>
                  <span className="text-muted-foreground text-sm">
                    {t("referral.guideline4")}
                  </span>
                </li>
                <li>
                  <span className="text-muted-foreground text-sm">
                    {t("referral.guideline5")}
                  </span>
                </li>
                <li>
                  <span className="text-muted-foreground text-sm">
                    {t("referral.guideline6")}
                  </span>
                </li>
                <li>
                  <span className="text-muted-foreground text-sm">
                    {t("referral.guideline7")}
                  </span>
                </li>
                <li>
                  <span className="text-muted-foreground text-sm">
                    {t("referral.guideline8")}
                  </span>
                </li>
              </ul>
              <p className="text-muted-foreground mt-4 px-5 text-sm">
                {t.rich("referral.termsText", {
                  link: (chunks) => (
                    <a
                      href="/terms-of-service"
                      target="_blank"
                      rel="noreferrer"
                      className="text-foreground hover:text-foreground/80 underline"
                    >
                      {chunks}
                    </a>
                  ),
                })}
              </p>
            </div>
          </>
        ) : (
          <>
            <DialogHeader className="flex flex-col items-center gap-3 pt-2 text-center sm:text-center">
              <div className="bg-foreground/10 text-foreground flex size-14 items-center justify-center rounded-2xl">
                <Gift className="size-7" />
              </div>
              <DialogTitle className="text-2xl font-semibold">
                {referrerRewardTitle}
              </DialogTitle>
              <DialogDescription className="text-muted-foreground max-w-xs text-sm">
                {t("referral.inviteTagline")}
              </DialogDescription>
            </DialogHeader>

            {isLoading ? (
              <>
                <div className="md:py-2">
                  <div className="text-muted-foreground mb-3 text-base font-normal">
                    {t("referral.howItWorks")}
                  </div>
                  <ul className="flex flex-col gap-4" aria-hidden="true">
                    {[0, 1, 2].map((i) => (
                      <li key={i} className="flex items-center gap-3">
                        <Skeleton className="size-9 shrink-0 rounded-lg" />
                        <Skeleton className="h-4 w-56 max-w-full" />
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="flex flex-col">
                  <Skeleton className="mb-3 h-4 w-44" aria-hidden="true" />
                  <div
                    className="bg-muted flex flex-wrap items-center justify-center gap-3 rounded-xl p-2"
                    aria-hidden="true"
                  >
                    <Skeleton className="size-24 shrink-0 rounded-lg md:size-28" />
                    <div className="flex min-w-32 flex-1 flex-col gap-2">
                      <Skeleton className="hidden h-10 w-full rounded-lg md:block" />
                      <Skeleton className="h-10 w-full rounded-[10px]" />
                    </div>
                  </div>
                </div>

                <div className="flex justify-center" aria-hidden="true">
                  <Skeleton className="h-5 w-40" />
                </div>
                <span className="sr-only" role="status">
                  {t("referral.loadingLink")}
                </span>
              </>
            ) : error ? (
              <div className="rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive">
                {error}
              </div>
            ) : program ? (
              <>
                <div className="md:py-2">
                  <div className="text-muted-foreground mb-3 text-base font-normal">
                    {t("referral.howItWorks")}
                  </div>
                  <ul className="flex flex-col gap-4">
                    <li className="flex items-center gap-3">
                      <span className="bg-muted text-foreground flex size-9 shrink-0 items-center justify-center rounded-lg">
                        <Zap className="size-5" />
                      </span>
                      <span className="text-foreground text-base font-normal">
                        {t("referral.stepShare")}
                      </span>
                    </li>
                    <li className="flex items-center gap-3">
                      <span className="bg-muted text-foreground flex size-9 shrink-0 items-center justify-center rounded-lg">
                        <UserPlus className="size-5" />
                      </span>
                      <span className="text-foreground text-base font-normal">
                        {t.rich("referral.stepSignup", {
                          bonus: referredSignupBonusCopy,
                          b: (chunks) => <b>{chunks}</b>,
                        })}
                      </span>
                    </li>
                    <li className="flex items-center gap-3">
                      <span className="bg-muted text-foreground flex size-9 shrink-0 items-center justify-center rounded-lg">
                        <Coins className="size-5" />
                      </span>
                      <span className="text-foreground text-base font-normal">
                        {referrerRewardCopy}
                      </span>
                    </li>
                  </ul>
                </div>

                <div className="flex flex-col">
                  <span className="text-muted-foreground mb-3 flex items-center gap-4 pr-2 text-base font-normal">
                    <span>
                      <b className="tabular-nums">
                        {program.stats.attributedSignups}
                      </b>{" "}
                      {t("referral.signedUp")}{" "}
                      <b className="tabular-nums">
                        {program.stats.paidConversions}
                      </b>{" "}
                      {t("referral.converted")}
                      {program.stats.awardedDollars > 0 ? (
                        <>
                          ,{" "}
                          <b className="tabular-nums">
                            ${program.stats.awardedDollars}
                          </b>{" "}
                          {t("referral.earned")}
                        </>
                      ) : null}
                    </span>
                  </span>

                  <div className="bg-muted flex flex-wrap items-center justify-center gap-3 rounded-xl p-2">
                    {program.active ? (
                      <div className="flex size-24 shrink-0 items-center justify-center rounded-lg border bg-white p-2 md:size-28">
                        <QRCodeSVG
                          value={program.referralUrl}
                          bgColor="#ffffff"
                          fgColor="#000000"
                          level="M"
                          marginSize={0}
                          className="size-full"
                          role="img"
                          aria-label={t("referral.qrLabel")}
                        />
                      </div>
                    ) : null}

                    <div className="flex min-w-32 flex-1 flex-col gap-2">
                      <div className="bg-background text-foreground hidden h-10 w-full items-center rounded-lg px-3 md:flex">
                        <LinkIcon className="text-muted-foreground mr-2 size-4 shrink-0" />
                        <span
                          className="text-foreground min-w-0 flex-1 truncate text-sm"
                          aria-label={t("referral.linkLabel")}
                        >
                          {program.active
                            ? program.referralUrl
                            : t("referral.linkInactive")}
                        </span>
                      </div>
                      <Button
                        type="button"
                        onClick={copyLink}
                        disabled={!program.active}
                        className="h-10 w-full rounded-[10px]"
                        aria-label={t("referral.copyLinkAria")}
                      >
                        {copied ? (
                          <>
                            <Check className="size-5" />
                            {t("referral.copied")}
                          </>
                        ) : (
                          <>
                            <Copy className="size-5" />
                            {t("referral.copyLink")}
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="flex justify-center">
                  <Button
                    type="button"
                    variant="link"
                    size="xs"
                    className="text-foreground"
                    onClick={() => setView("guidelines")}
                  >
                    {t("referral.viewTerms")}
                  </Button>
                </div>
              </>
            ) : null}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
