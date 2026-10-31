import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type CostTier = "free" | "low" | "medium" | "high" | "very-high";

// Faixa de custo por id. Tiers legados (hackerai-*) mantidos p/ compat; os
// modelos concretos do seletor do operador usam o preço REAL de saída ($/M do
// OpenRouter, 28/09) p/ dar o espectro $ / $$ / $$$ / $$$+ e permitir escolher
// por custo. "free" = $0 (modelos `:free`; o provedor pode treinar com o prompt).
// Re-sondar o catálogo se os preços mudarem materialmente.
export function getCostTier(modelId: string): CostTier {
  switch (modelId) {
    // Tiers legados.
    case "hackerai-standard":
      return "low";
    case "hackerai-pro":
      return "medium";
    case "hackerai-max":
      return "very-high";
    // Gratuitos ($0).
    case "model-nemotron-3-ultra-free":
    case "model-nemotron-3-super-free":
    case "model-qwen3.8-27b-free":
    case "model-gemma-4-31b-free":
      return "free";
    // Baratos ($): GLM Flash ~$0.5, DeepSeek Flash ~$0.28, V4.1 Flash ~$1.20.
    case "model-glm-5.3-flash":
    case "model-deepseek-v4-flash-0731":
    case "model-deepseek-v4.1-flash":
      return "low";
    // Intermediários ($$): DeepSeek V4 Pro ~$3.5, GLM 5.3 ~$4.40.
    case "model-deepseek-v4-pro-0813":
    case "model-glm-5.3":
      return "medium";
    // Caros ($$$): Grok 4.6/4.7 ~$6.00.
    case "model-grok-4.6":
    case "model-grok-4.7":
      return "high";
    // Mais caro ($$$+): Kimi K3 ~$15.00.
    case "model-kimi-k3":
      return "very-high";
    default:
      return "medium";
  }
}

const COST_CONFIG: Record<
  CostTier,
  { count: number; label: string; activeClass: string; suffix?: string }
> = {
  free: {
    count: 0,
    label: "Gratuito · o provedor pode treinar com o prompt",
    activeClass: "text-sky-600/80 dark:text-sky-400/80",
  },
  low: {
    count: 1,
    label: "Low cost",
    activeClass: "text-emerald-600/80 dark:text-emerald-400/80",
  },
  medium: {
    count: 2,
    label: "Medium cost",
    activeClass: "text-amber-600/80 dark:text-amber-400/80",
  },
  high: {
    count: 3,
    label: "High cost",
    activeClass: "text-orange-600/80 dark:text-orange-400/80",
  },
  "very-high": {
    count: 3,
    label: "Very high cost",
    activeClass: "text-red-600/80 dark:text-red-400/80",
    suffix: "+",
  },
};

const MAX_DOLLARS = 3;

export function CostIndicator({ modelId }: { modelId: string }) {
  const tier = getCostTier(modelId);
  const config = COST_CONFIG[tier];

  // Gratuito: em vez de cifrões apagados (que leriam como "custo baixo"),
  // um selo explícito — o ponto NÃO é só o preço, é a política de dados.
  const body =
    tier === "free" ? (
      <span
        aria-label={`Cost: ${config.label}`}
        className={`inline-flex items-center rounded px-1 text-[10px] font-semibold uppercase tracking-wide cursor-default bg-sky-500/10 ${config.activeClass}`}
      >
        Grátis
      </span>
    ) : (
      <span
        aria-label={`Cost: ${config.label}`}
        className="inline-flex items-center gap-0 font-semibold tracking-tight text-xs cursor-default"
      >
        {Array.from({ length: MAX_DOLLARS }, (_, i) => (
          <span
            key={i}
            aria-hidden="true"
            className={
              i < config.count ? config.activeClass : "text-muted-foreground/30"
            }
          >
            $
          </span>
        ))}
        {config.suffix && (
          <span aria-hidden="true" className={config.activeClass}>
            {config.suffix}
          </span>
        )}
      </span>
    );

  return (
    <Tooltip>
      <TooltipTrigger asChild>{body}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={4} className="text-xs px-2 py-1">
        {config.label}
      </TooltipContent>
    </Tooltip>
  );
}
