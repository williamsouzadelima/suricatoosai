"use client";

import {
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  Lock,
  ShieldAlert,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  canUseMaxModel,
  normalizeMaxModelForSubscription,
  normalizeSelectedModelForSubscription,
  isFreeModelSelection,
  type ChatMode,
  type SelectedModel,
  type SubscriptionTier,
} from "@/types/chat";
import { isAgentMode } from "@/lib/utils/mode-helpers";
import { useGlobalState } from "@/app/contexts/GlobalState";
import { useIsMobile } from "@/hooks/use-mobile";
import { redirectToPricing } from "@/app/hooks/usePricingDialog";
import { openSettingsDialog } from "@/lib/utils/settings-dialog";

import { CostIndicator } from "./ModelSelector/CostIndicator";
import {
  ASK_MODEL_OPTIONS,
  AGENT_MODEL_OPTIONS,
  getDefaultModelForMode,
  getFreeModelOptions,
  type ModelOption,
} from "./ModelSelector/constants";

// ── Shared sub-components ──────────────────────────────────────────

interface ModelSelectorProps {
  value: SelectedModel;
  onChange: (model: SelectedModel) => void;
  mode: ChatMode;
  /** O chat atual pertence a um engajamento/cliente → modelos GRATUITOS ficam
   *  bloqueados na UI (o servidor impõe o mesmo portão independentemente). */
  engagementBound?: boolean;
}

const AUTO_MODEL_DESCRIPTION =
  "Balanced quality and speed, recommended for most tasks";

const isMaxModel = (model: SelectedModel): boolean => model === "hackerai-max";

const canUnlockMaxWithExtraUsage = (subscription: SubscriptionTier): boolean =>
  subscription !== "free" && subscription !== "ultra";

const canChoosePersonalMaxAccessPath = (
  subscription: SubscriptionTier,
): boolean => subscription === "pro" || subscription === "pro-plus";

const isModelLockedForSubscription = (
  subscription: SubscriptionTier,
  model: SelectedModel,
  extraUsageAvailable = false,
): boolean =>
  subscription === "free" ||
  (isMaxModel(model) && !canUseMaxModel(subscription, { extraUsageAvailable }));

const getLockedModelCta = (
  model: SelectedModel,
  subscription: SubscriptionTier,
): string => {
  if (isMaxModel(model) && canUnlockMaxWithExtraUsage(subscription)) {
    return "Set up Extra Usage";
  }
  return isMaxModel(model) ? "Upgrade to Ultra" : "Upgrade your plan";
};

const getLockedModelAnnouncement = (
  model: SelectedModel,
  subscription: SubscriptionTier,
): string => {
  if (isMaxModel(model) && canChoosePersonalMaxAccessPath(subscription)) {
    return "Use Extra Usage or upgrade to Ultra for Max mode";
  }

  return `${getLockedModelCta(model, subscription)}${
    isMaxModel(model) ? " for Max mode" : " to unlock"
  }`;
};

const openMaxUltraUpgrade = ({
  mobile,
  subscription,
}: {
  mobile: boolean;
  subscription: SubscriptionTier;
}) => {
  redirectToPricing({
    surface: mobile ? "model_selector_mobile" : "model_selector",
    source: "max_model_gate",
    from_tier: subscription,
    cta_text: "Upgrade to Ultra",
  });
};

const handleLockedModelCta = ({
  mobile,
  option,
  subscription,
}: {
  mobile: boolean;
  option: ModelOption;
  subscription: SubscriptionTier;
}) => {
  const maxLocked = isMaxModel(option.id);
  if (maxLocked && canUnlockMaxWithExtraUsage(subscription)) {
    openSettingsDialog("Extra Usage");
    return;
  }

  redirectToPricing({
    surface: mobile ? "model_selector_mobile" : "model_selector",
    source: maxLocked ? "max_model_gate" : "locked_model_option",
    from_tier: subscription,
    cta_text: getLockedModelCta(option.id, subscription),
  });
};

const AutoOptionButton = ({
  isSelected,
  onSelect,
  mobile = false,
}: {
  isSelected: boolean;
  onSelect: () => void;
  mobile?: boolean;
}) => (
  <button
    type="button"
    onClick={onSelect}
    aria-pressed={isSelected}
    className={`group w-full flex items-center gap-2.5 px-2.5 rounded-lg text-left transition-colors select-none cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
      mobile ? "py-2.5" : "py-2"
    } ${isSelected ? "bg-accent" : "hover:bg-muted/50 active:bg-muted/50"}`}
  >
    <div className="flex-1 min-w-0">
      <span
        className={`text-sm font-medium transition-colors ${
          isSelected
            ? "text-accent-foreground"
            : "text-muted-foreground group-hover:text-foreground"
        }`}
      >
        Auto
      </span>
      <p className="text-xs text-muted-foreground leading-snug mt-0.5">
        {AUTO_MODEL_DESCRIPTION}
      </p>
    </div>
    {isSelected ? <Check className="h-3.5 w-3.5 shrink-0" /> : null}
  </button>
);

const ModelOptionButton = ({
  option,
  isSelected,
  isLocked,
  isPending,
  subscription,
  onSelect,
  mobile = false,
}: {
  option: ModelOption;
  isSelected: boolean;
  isLocked: boolean;
  isPending: boolean;
  subscription: SubscriptionTier;
  onSelect: (option: ModelOption) => void;
  mobile?: boolean;
}) => {
  const button = (
    <button
      type="button"
      onClick={() => onSelect(option)}
      disabled={isPending}
      aria-busy={isPending || undefined}
      aria-pressed={isSelected}
      aria-label={
        isPending
          ? `${option.label}. Checking Extra Usage for Max mode.`
          : isLocked
            ? `${option.label}. ${getLockedModelAnnouncement(
                option.id,
                subscription,
              )}.`
            : undefined
      }
      className={`group w-full flex items-center gap-2.5 px-2.5 rounded-lg text-left transition-colors select-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
        mobile ? "py-2.5" : "py-1.5"
      } ${
        isPending
          ? `cursor-wait opacity-80 ${isSelected ? "bg-accent" : ""}`
          : isSelected
            ? "cursor-pointer bg-accent"
            : "cursor-pointer hover:bg-muted/50 active:bg-muted/50"
      }`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span
            className={`text-sm transition-colors ${
              isSelected
                ? "text-accent-foreground"
                : "text-muted-foreground group-hover:text-foreground"
            }`}
          >
            {option.label}
          </span>
          {option.thinking && (
            <Brain className="h-3 w-3 text-muted-foreground/60" />
          )}
          {option.id !== "auto" && <CostIndicator modelId={option.id} />}
        </div>
      </div>
      {isPending ? (
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
      ) : isLocked ? (
        <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover:text-foreground transition-colors" />
      ) : isSelected ? (
        <Check className="h-3.5 w-3.5 shrink-0" />
      ) : null}
    </button>
  );

  // Locked options get the upgrade tooltip from the parent ModelOptionList; skipping
  // the inner one prevents a flicker where both nested tooltips race to render.
  if (mobile || !option.description || isLocked) return button;

  return (
    <Tooltip delayDuration={150}>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent
        side="right"
        sideOffset={12}
        align="start"
        className="bg-popover text-popover-foreground border border-border shadow-lg rounded-xl px-4 py-3 max-w-[240px] space-y-1.5 [&_svg]:!hidden"
      >
        <p className="text-sm font-semibold text-foreground leading-snug">
          {option.description}
        </p>
        {option.poweredBy && (
          <p className="text-xs text-muted-foreground">
            Powered by {option.poweredBy}
          </p>
        )}
      </TooltipContent>
    </Tooltip>
  );
};

// ── Model option list ──────────────────────────────────────────────

const ModelOptionList = ({
  options,
  value,
  isAuto,
  isFreeUser,
  subscription,
  maxModelExtraUsageAvailable,
  maxModelEntitlementLoading,
  onAutoSelect,
  onSelect,
  onClose,
  mobile = false,
  freeOptions = [],
  engagementBound = false,
}: {
  options: ModelOption[];
  freeOptions?: ModelOption[];
  engagementBound?: boolean;
  value: SelectedModel;
  isAuto: boolean;
  isFreeUser: boolean;
  subscription: SubscriptionTier;
  maxModelExtraUsageAvailable: boolean;
  maxModelEntitlementLoading: boolean;
  onAutoSelect: () => void;
  onSelect: (option: ModelOption) => void;
  onClose: () => void;
  mobile?: boolean;
}) => (
  <div className="flex flex-col gap-px">
    {isFreeUser ? (
      <>
        <a
          href="#pricing"
          onClick={(event) => {
            event.preventDefault();
            onClose();
            redirectToPricing({
              surface: mobile ? "model_selector_mobile" : "model_selector",
              source: "model_gate",
              from_tier: "free",
              cta_text: "Get access to paid models",
            });
          }}
          className="flex items-center justify-between rounded-lg border border-primary/40 bg-primary/10 px-2.5 py-2 transition-colors hover:bg-primary/20 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <span className="text-sm font-semibold text-foreground">
            Get access to paid models
          </span>
          <ChevronRight className="h-4 w-4 text-primary shrink-0" />
        </a>
        <div className="my-1.5 border-b border-border/50" />
      </>
    ) : (
      <>
        <AutoOptionButton
          isSelected={isAuto}
          onSelect={onAutoSelect}
          mobile={mobile}
        />
        <div className="my-1 border-b border-border/50" />
      </>
    )}

    {options.map((option) => {
      const isSelected = value === option.id;
      const isLocked = isModelLockedForSubscription(
        subscription,
        option.id,
        maxModelExtraUsageAvailable,
      );
      const isPending = isMaxModel(option.id) && maxModelEntitlementLoading;
      const showUpgradeTooltip =
        isLocked &&
        !mobile &&
        !(isMaxModel(option.id) && maxModelEntitlementLoading);

      if (!showUpgradeTooltip) {
        return (
          <div key={option.id}>
            <ModelOptionButton
              option={option}
              isSelected={isSelected}
              isLocked={isLocked}
              isPending={isPending}
              subscription={subscription}
              onSelect={onSelect}
              mobile={mobile}
            />
          </div>
        );
      }

      return (
        <Tooltip key={option.id}>
          <TooltipTrigger asChild>
            <div>
              <ModelOptionButton
                option={option}
                isSelected={isSelected}
                isLocked={isLocked}
                isPending={false}
                subscription={subscription}
                onSelect={onSelect}
                mobile={mobile}
              />
            </div>
          </TooltipTrigger>
          <TooltipContent
            side="right"
            sideOffset={12}
            align="start"
            className="bg-popover text-popover-foreground border border-border shadow-lg rounded-xl px-4 py-3 max-w-[240px] space-y-1.5 [&_svg]:!hidden"
          >
            {option.description ? (
              <p className="text-sm font-semibold text-foreground leading-snug">
                {option.description}
              </p>
            ) : (
              <p className="text-sm font-semibold text-foreground leading-snug">
                {option.label}
              </p>
            )}
            {option.poweredBy && (
              <p className="text-xs text-muted-foreground">
                Powered by {option.poweredBy}
              </p>
            )}
            <p className="text-xs text-muted-foreground leading-relaxed pt-1">
              <a
                href={
                  isMaxModel(option.id) &&
                  canUnlockMaxWithExtraUsage(subscription)
                    ? "#extra-usage"
                    : "#pricing"
                }
                onClick={(event) => {
                  event.preventDefault();
                  onClose();
                  handleLockedModelCta({
                    mobile,
                    option,
                    subscription,
                  });
                }}
                className="text-foreground underline underline-offset-2 hover:text-foreground/80"
                tabIndex={0}
              >
                {getLockedModelCta(option.id, subscription)}
              </a>
              {isMaxModel(option.id) ? " for Max mode." : " to unlock."}
            </p>
          </TooltipContent>
        </Tooltip>
      );
    })}

    {/* Gratuitos: grupo SEPARADO (nunca default), com selo de política de dados.
        Em chat de engajamento/cliente ficam bloqueados — e o servidor impõe o
        mesmo portão, então isto é aviso honesto, não a proteção em si. */}
    {!isFreeUser && freeOptions.length > 0 && (
      <>
        <div className="my-1.5 border-b border-border/50" />
        <div className="flex items-center gap-1.5 px-2.5 pb-1 pt-0.5">
          <ShieldAlert className="h-3 w-3 shrink-0 text-sky-500" />
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Gratuitos · podem treinar com o prompt
          </span>
        </div>
        {engagementBound && (
          <p
            className="px-2.5 pb-1 text-[11px] leading-snug text-amber-600 dark:text-amber-400"
            data-testid="free-models-blocked-notice"
          >
            Bloqueados nesta tarefa: ela pertence a um engajamento/cliente.
          </p>
        )}
        {freeOptions.map((option) => {
          if (!engagementBound) {
            return (
              <div key={option.id}>
                <ModelOptionButton
                  option={option}
                  isSelected={value === option.id}
                  isLocked={false}
                  isPending={false}
                  subscription={subscription}
                  onSelect={onSelect}
                  mobile={mobile}
                />
              </div>
            );
          }
          // Bloqueado: botão próprio (não reutiliza isLocked, cujo aria/CTA é
          // "upgrade de plano" — semântica errada aqui) e sem tooltip aninhado.
          const blocked = (
            <button
              type="button"
              disabled
              aria-disabled="true"
              aria-label={`${option.label}. Bloqueado: esta tarefa pertence a um engajamento/cliente.`}
              className={`group w-full flex items-center gap-2.5 px-2.5 rounded-lg text-left select-none cursor-not-allowed opacity-50 ${
                mobile ? "py-2.5" : "py-1.5"
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm text-muted-foreground">
                    {option.label}
                  </span>
                  <CostIndicator modelId={option.id} />
                </div>
              </div>
              <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </button>
          );
          if (mobile) return <div key={option.id}>{blocked}</div>;
          return (
            <Tooltip key={option.id}>
              <TooltipTrigger asChild>
                <div>{blocked}</div>
              </TooltipTrigger>
              <TooltipContent
                side="right"
                sideOffset={12}
                align="start"
                className="bg-popover text-popover-foreground border border-border shadow-lg rounded-xl px-4 py-3 max-w-[240px] space-y-1.5 [&_svg]:!hidden"
              >
                <p className="text-sm font-semibold text-foreground leading-snug">
                  Bloqueado em tarefa de cliente
                </p>
                <p className="text-xs text-muted-foreground">
                  Modelos gratuitos podem treinar com o prompt; esta tarefa está
                  ligada a um engajamento. O servidor usaria o modelo pago mesmo
                  assim.
                </p>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </>
    )}
  </div>
);

// ── Main component ─────────────────────────────────────────────────

export function ModelSelector({
  value,
  onChange,
  mode,
  engagementBound = false,
}: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const [maxAccessDialogOpen, setMaxAccessDialogOpen] = useState(false);
  const { subscription } = useGlobalState();
  const isMobile = Boolean(useIsMobile());

  const isFreeUser = subscription === "free";
  const shouldCheckPersonalMaxExtraUsage =
    (subscription === "pro" || subscription === "pro-plus") &&
    (open || value === "hackerai-max");
  const maxModelEntitlement = useQuery(
    api.extraUsage.getMaxModelExtraUsageEntitlement,
    shouldCheckPersonalMaxExtraUsage ? {} : "skip",
  );
  const maxModelEntitlementLoading =
    shouldCheckPersonalMaxExtraUsage && maxModelEntitlement === undefined;
  const maxModelExtraUsageAvailable =
    maxModelEntitlement?.extraUsageAvailable ?? false;
  const subscriptionValue = normalizeSelectedModelForSubscription(
    value,
    subscription,
  );
  const displayValue =
    value === "hackerai-max" && maxModelEntitlementLoading
      ? subscriptionValue
      : (normalizeMaxModelForSubscription(subscriptionValue, subscription, {
          extraUsageAvailable: maxModelExtraUsageAvailable,
        }) ?? "auto");
  // Chat de engajamento: um free escolhido antes não pode aparecer como ativo
  // (o servidor rebaixa p/ auto). Espelha aqui p/ o rótulo do gatilho não mentir.
  const boundSafeValue: SelectedModel =
    engagementBound && isFreeModelSelection(displayValue)
      ? "auto"
      : displayValue;
  const isAuto = boundSafeValue === "auto";

  // Exibir "Auto" não basta: o estado REAL (GlobalState/localStorage) seguiria
  // no free e re-armaria a preferência na próxima tarefa nova (opt-in violado
  // em silêncio). Em chat de engajamento, normaliza a preferência de verdade.
  useEffect(() => {
    if (engagementBound && isFreeModelSelection(value)) onChange("auto");
  }, [engagementBound, value, onChange]);

  const options = isAgentMode(mode) ? AGENT_MODEL_OPTIONS : ASK_MODEL_OPTIONS;
  const freeOptions = getFreeModelOptions(mode);

  const effectiveValue = isAuto
    ? getDefaultModelForMode(mode)
    : boundSafeValue;
  const selected =
    options.find((opt) => opt.id === effectiveValue) ??
    freeOptions.find((opt) => opt.id === effectiveValue) ??
    options[0];

  const isFreeAgent = isFreeUser && isAgentMode(mode);
  const triggerLabel = isFreeAgent
    ? "Auto"
    : isFreeUser
      ? "Model"
      : isAuto
        ? "Auto"
        : selected.label;

  const handleAutoSelect = () => {
    onChange("auto");
    setOpen(false);
  };

  const applyModelChoice = (option: ModelOption) => {
    onChange(option.id);
    setOpen(false);
  };

  const handleModelSelect = (option: ModelOption) => {
    if (isMaxModel(option.id) && maxModelEntitlementLoading) {
      return;
    }

    if (
      isModelLockedForSubscription(
        subscription,
        option.id,
        maxModelExtraUsageAvailable,
      )
    ) {
      setOpen(false);
      if (
        isMaxModel(option.id) &&
        canChoosePersonalMaxAccessPath(subscription)
      ) {
        setMaxAccessDialogOpen(true);
        return;
      }

      handleLockedModelCta({
        mobile: isMobile,
        option,
        subscription,
      });
      return;
    }

    applyModelChoice(option);
  };

  const trigger = (
    <Button
      variant="ghost"
      size="sm"
      onClick={isMobile ? () => setOpen(true) : undefined}
      aria-expanded={isMobile ? open : undefined}
      aria-haspopup={isMobile ? "dialog" : undefined}
      className="h-7 px-2 gap-1 text-sm font-medium rounded-md bg-transparent hover:bg-muted/30 focus-visible:ring-1 min-w-0 shrink"
    >
      <span className="truncate">{triggerLabel}</span>
      <ChevronDown className="h-3 w-3 ml-0.5 shrink-0" />
    </Button>
  );

  const maxAccessDialog = (
    <Dialog open={maxAccessDialogOpen} onOpenChange={setMaxAccessDialogOpen}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-sm rounded-2xl p-5">
        <DialogHeader>
          <DialogTitle>Unlock Suricatoos Max</DialogTitle>
          <DialogDescription className="leading-relaxed">
            On Pro and Pro+, use Extra Usage to pay for Max as you go, or
            upgrade to Ultra to have Max included.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2 pt-2">
          <Button
            type="button"
            onClick={() => {
              setMaxAccessDialogOpen(false);
              openSettingsDialog("Extra Usage");
            }}
          >
            Use Extra Usage
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setMaxAccessDialogOpen(false);
              openMaxUltraUpgrade({
                mobile: isMobile,
                subscription,
              });
            }}
          >
            Upgrade to Ultra
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );

  if (isMobile) {
    return (
      <>
        {trigger}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent
            side="bottom"
            className="rounded-t-2xl px-3 pb-8 pt-0 overscroll-contain"
          >
            <SheetHeader className="pb-1 pt-4">
              <SheetTitle className="text-base">Select Model</SheetTitle>
              <SheetDescription className="sr-only">
                Choose a model
              </SheetDescription>
            </SheetHeader>
            <ModelOptionList
              options={options}
              value={boundSafeValue}
              isAuto={isAuto}
              isFreeUser={isFreeUser}
              subscription={subscription}
              maxModelExtraUsageAvailable={maxModelExtraUsageAvailable}
              maxModelEntitlementLoading={maxModelEntitlementLoading}
              onAutoSelect={handleAutoSelect}
              onSelect={handleModelSelect}
              onClose={() => setOpen(false)}
              freeOptions={freeOptions}
              engagementBound={engagementBound}
              mobile
            />
          </SheetContent>
        </Sheet>
        {maxAccessDialog}
      </>
    );
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent className="w-[270px] p-1.5 rounded-xl" align="start">
          <ModelOptionList
            options={options}
            value={boundSafeValue}
            isAuto={isAuto}
            isFreeUser={isFreeUser}
            subscription={subscription}
            maxModelExtraUsageAvailable={maxModelExtraUsageAvailable}
            maxModelEntitlementLoading={maxModelEntitlementLoading}
            onAutoSelect={handleAutoSelect}
            onSelect={handleModelSelect}
            onClose={() => setOpen(false)}
            freeOptions={freeOptions}
            engagementBound={engagementBound}
          />
        </PopoverContent>
      </Popover>
      {maxAccessDialog}
    </>
  );
}
