/**
 * "Pregão de LLMs" — v1 (lê + recomenda; NÃO troca nada automaticamente).
 * Universo de candidatos por tier, jurisdição de dados, e o cálculo do índice
 * combinado (excelência × financeiro). Puro (sem rede) — a rede vive na rota
 * /api/admin/model-exchange. A troca automática guardrailed é v3.
 */

export type TierId = "standard" | "pro" | "max";
export type Jurisdiction = "US" | "China" | "EU" | "Other";

export interface Candidate {
  slug: string; // slug OpenRouter
  label: string;
  family: string;
  jurisdiction: Jurisdiction;
  tiers: TierId[];
  /** Custo $0 no OpenRouter; o provedor pode TREINAR com o prompt. Medido no
   *  eval-gate, mas NUNCA candidato a padrão de tier (tiers: []) — só serve
   *  chat sem engajamento/cliente (portão em lib/chat/free-model-gate.ts). */
  free?: boolean;
}

/** Mapeamento ATUAL tier→modelo (fonte: constants.ts poweredBy / providers.ts). */
export const CURRENT_ASSIGNMENT: Record<TierId, string> = {
  standard: "deepseek/deepseek-v4-flash-0731",
  pro: "deepseek/deepseek-v4-pro-0813",
  max: "x-ai/grok-4.6",
};

/** O que o upstream (hackerai.co) usa hoje — referência SOTA (27/09). */
export const UPSTREAM_ASSIGNMENT: Record<TierId, string> = {
  standard: "z-ai/glm-5.3-flash",
  pro: "deepseek/deepseek-v4.1-flash",
  max: "z-ai/glm-5.3",
};

/** Universo curado de candidatos (modelos fortes das famílias que usamos). */
export const CANDIDATES: Candidate[] = [
  { slug: "deepseek/deepseek-v4-flash-0731", label: "DeepSeek V4 Flash 0731", family: "deepseek", jurisdiction: "China", tiers: ["standard"] },
  { slug: "z-ai/glm-5.3-flash", label: "GLM 5.3 Flash", family: "glm", jurisdiction: "China", tiers: ["standard"] },
  { slug: "deepseek/deepseek-v4.1-flash", label: "DeepSeek V4.1 Flash", family: "deepseek", jurisdiction: "China", tiers: ["standard", "pro"] },
  { slug: "deepseek/deepseek-v4-pro-0813", label: "DeepSeek V4 Pro 0813", family: "deepseek", jurisdiction: "China", tiers: ["pro"] },
  { slug: "deepseek/deepseek-v4-pro", label: "DeepSeek V4 Pro", family: "deepseek", jurisdiction: "China", tiers: ["pro", "max"] },
  { slug: "z-ai/glm-5.3", label: "GLM 5.3", family: "glm", jurisdiction: "China", tiers: ["pro", "max"] },
  { slug: "x-ai/grok-4.6", label: "Grok 4.6", family: "grok", jurisdiction: "US", tiers: ["max"] },
  { slug: "x-ai/grok-4.7", label: "Grok 4.7", family: "grok", jurisdiction: "US", tiers: ["max"] },
  { slug: "moonshotai/kimi-k3", label: "Kimi K3", family: "kimi", jurisdiction: "China", tiers: ["max"] },
  // Gratuitos (`:free`, $0): aparecem na tabela do eval-gate p/ medir, mas
  // tiers: [] → jamais recomendados como padrão (treinam com o prompt).
  { slug: "nvidia/nemotron-3-ultra-550b-a55b:free", label: "Nemotron 3 Ultra (free)", family: "nemotron", jurisdiction: "US", tiers: [], free: true },
  { slug: "nvidia/nemotron-3-super-120b-a12b:free", label: "Nemotron 3 Super (free)", family: "nemotron", jurisdiction: "US", tiers: [], free: true },
  { slug: "qwen/qwen3.8-27b:free", label: "Qwen 3.8 27B (free)", family: "qwen", jurisdiction: "China", tiers: [], free: true },
  { slug: "google/gemma-4-31b-it:free", label: "Gemma 4 31B (free)", family: "gemma", jurisdiction: "US", tiers: [], free: true },
];

const CANDIDATE_SLUG_SET: ReadonlySet<string> = new Set(
  CANDIDATES.map((c) => c.slug),
);

/**
 * Aliases: variante datada `-YYYYMMDD` conhecida OU nome interno `model-*` →
 * slug canônico do candidato. Evita a colisão `-0813` (candidato) vs
 * `-20260813` (datado). O que não estiver aqui cai no strip de `-\d{8}` abaixo.
 */
export const MODEL_SLUG_ALIASES: Record<string, string> = {
  "deepseek/deepseek-v4-flash-20260731": "deepseek/deepseek-v4-flash-0731",
  "deepseek/deepseek-v4-pro-20260813": "deepseek/deepseek-v4-pro-0813",
  "x-ai/grok-4.6-20260810": "x-ai/grok-4.6",
  "z-ai/glm-5.3-20260816": "z-ai/glm-5.3",
  "moonshotai/kimi-k3-20260715": "moonshotai/kimi-k3",
  // Nomes internos (defensivo; usage_logs guarda slug, messages.model idem).
  "model-grok-4.6": "x-ai/grok-4.6",
  "model-grok-4.7": "x-ai/grok-4.7",
  "agent-model": "x-ai/grok-4.6",
  "ask-model": "x-ai/grok-4.6",
  "fallback-agent-model": "x-ai/grok-4.6",
  "fallback-ask-model": "x-ai/grok-4.6",
  "model-deepseek-v4-flash-0731": "deepseek/deepseek-v4-flash-0731",
  "agent-model-free": "deepseek/deepseek-v4-flash-0731",
  "model-deepseek-v4-pro-0813": "deepseek/deepseek-v4-pro-0813",
  "model-deepseek-v4-pro": "deepseek/deepseek-v4-pro",
  "model-deepseek-v4.1-flash": "deepseek/deepseek-v4.1-flash",
  "model-glm-5.3": "z-ai/glm-5.3",
  "model-glm-5.3-flash": "z-ai/glm-5.3-flash",
  "ask-model-free": "z-ai/glm-5.3-flash",
  "model-kimi-k3": "moonshotai/kimi-k3",
  "model-opus-4.6": "moonshotai/kimi-k3",
  // Gratuitos: nome interno e slug SEM `:free` (o OpenRouter pode reportar o
  // servido assim) → slug canônico do candidato (COM `:free`).
  "model-nemotron-3-ultra-free": "nvidia/nemotron-3-ultra-550b-a55b:free",
  "nvidia/nemotron-3-ultra-550b-a55b": "nvidia/nemotron-3-ultra-550b-a55b:free",
  "model-nemotron-3-super-free": "nvidia/nemotron-3-super-120b-a12b:free",
  "nvidia/nemotron-3-super-120b-a12b": "nvidia/nemotron-3-super-120b-a12b:free",
  "model-qwen3.8-27b-free": "qwen/qwen3.8-27b:free",
  "qwen/qwen3.8-27b": "qwen/qwen3.8-27b:free",
  "model-gemma-4-31b-free": "google/gemma-4-31b-it:free",
  "google/gemma-4-31b-it": "google/gemma-4-31b-it:free",
};

/**
 * Normaliza um `model` bruto (slug servido do OpenRouter, com/sem sufixo de
 * data, ou nome interno) para o slug canônico de um candidato. Slugs
 * desconhecidos voltam como estão (não casam com nenhum candidato → ignorados).
 */
export function canonicalizeModelSlug(raw: string): string {
  if (MODEL_SLUG_ALIASES[raw]) return MODEL_SLUG_ALIASES[raw];
  const m = raw.match(/^(.+)-\d{8}$/); // variante datada -YYYYMMDD
  if (m && CANDIDATE_SLUG_SET.has(m[1])) return m[1];
  return raw;
}

export interface MarketData {
  slug: string;
  priceIn: number | null; // $ por token
  priceOut: number | null;
  contextLength: number | null;
  uptime30m: number | null; // %
  uptime1d: number | null;
  latencyMs: number | null;
  throughput: number | null; // tokens/s
  providerCount: number;
  supportsTools: boolean | null;
  createdIso: string | null;
}

/** Custo/uso REAL nosso por modelo (do usage_logs, via getCostAnalyticsForBackend.byModel). */
export interface OurUsage {
  slug: string;
  requests: number;
  costDollars: number;
  outputTokens: number;
}

export const TIER_LABELS: Record<TierId, string> = {
  standard: "Standard",
  pro: "Pro",
  max: "Max",
};

/** Limiares de elegibilidade (portões, não médias). */
export const MIN_UPTIME_30M = 95; // %
export const REQUIRE_TOOLS = true; // agente de pentest precisa de tool-calling

export function isEligible(m: MarketData | undefined): boolean {
  if (!m) return false;
  if (m.priceOut == null) return false;
  if (m.uptime30m != null && m.uptime30m < MIN_UPTIME_30M) return false;
  if (REQUIRE_TOOLS && m.supportsTools === false) return false;
  return true;
}

/**
 * Escore combinado CRU ∈ [0,1] (maior = melhor custo-benefício). Base da seleção
 * (comparação sem arredondamento, p/ não criar empates artificiais). v1: pesa
 * CUSTO (dominado pelo output, o gasto real do agente) e recompensa qualidade.
 * qualityScore ∈ [0,1] (v1: neutro 0.5 até o eval-gate v2 medir de verdade).
 * weight ∈ [0,1] = peso da QUALIDADE vs custo (0.5 = equilíbrio).
 */
export function blendedScore(
  m: MarketData,
  qualityScore = 0.5,
  weight = 0.5,
): number | null {
  if (m.priceOut == null) return null;
  // Custo efetivo estimado por 1M tokens (out pesa 3x mais que in — perfil do agente).
  const effCost = (m.priceOut * 3 + (m.priceIn ?? 0)) * 1e6;
  if (effCost <= 0) return null;
  // Barateamento normalizado (referência $30/M = caro; quanto menor, melhor).
  const costScore = Math.max(0, Math.min(1, 1 - effCost / 30));
  const q = Math.max(0, Math.min(1, qualityScore));
  const w = Math.max(0, Math.min(1, weight));
  return w * q + (1 - w) * costScore;
}

/** Índice combinado 0-100 (escore cru × 100, arredondado) — para exibição. */
export function blendedIndex(
  m: MarketData,
  qualityScore = 0.5,
  weight = 0.5,
): number | null {
  const s = blendedScore(m, qualityScore, weight);
  return s == null ? null : Math.round(s * 100);
}

// Margem mínima de escore cru p/ um candidato "vencer" o modelo atual. Evita
// recomendar troca por diferença desprezível (ou por empate — ver eval-gate v2).
const SWITCH_MARGIN = 0.02;

export interface TierRecommendation {
  tier: TierId;
  currentSlug: string;
  recommendedSlug: string | null;
  reason: string;
  // Custo do NOSSO volume de saída real da janela, precificado neste modelo
  // (comparação "mesmo volume, outro preço") — NÃO é mensal salvo se a janela for 30d.
  periodCostNow: number | null;
  periodCostRecommended: number | null;
}

/**
 * Custo do nosso volume de saída real da janela (byModel.outputTokens do modelo
 * ATUAL do tier) precificado ao preço de saída do candidato. É uma comparação
 * "se rodássemos o mesmo volume neste modelo, quanto sairia" — não uma projeção.
 */
function estPeriodCost(m: MarketData, usage: OurUsage | undefined): number | null {
  if (!usage || m.priceOut == null) return null;
  return usage.outputTokens * m.priceOut;
}

/**
 * Recomenda o melhor candidato ELEGÍVEL por tier pelo índice combinado.
 * v1 NÃO aplica nada — só sugere. Qualidade entra de verdade no v2 (eval-gate),
 * então aqui a recomendação é transparente e conservadora.
 */
export function recommendPerTier(
  market: Map<string, MarketData>,
  usageByCurrent: Map<string, OurUsage>,
  qualityBySlug: Map<string, number>,
  weight = 0.5,
): TierRecommendation[] {
  return (["standard", "pro", "max"] as TierId[]).map((tier) => {
    const currentSlug = CURRENT_ASSIGNMENT[tier];
    const currentUsage = usageByCurrent.get(currentSlug);
    const eligible = CANDIDATES.filter(
      (c) => c.tiers.includes(tier) && isEligible(market.get(c.slug)),
    );
    // Melhor candidato pelo ESCORE CRU (sem arredondar → sem empate artificial).
    let best: { slug: string; score: number } | null = null;
    for (const c of eligible) {
      const m = market.get(c.slug);
      if (!m) continue;
      const score = blendedScore(m, qualityBySlug.get(c.slug) ?? 0.5, weight);
      if (score == null) continue;
      if (!best || score > best.score) best = { slug: c.slug, score };
    }
    const curM = market.get(currentSlug);
    // Escore do modelo ATUAL — null quando ele está INELEGÍVEL (fora do ar / sem
    // tools / sem preço). Nesse caso qualquer melhor elegível deve ser sugerido.
    const currentScore = isEligible(curM)
      ? blendedScore(curM!, qualityBySlug.get(currentSlug) ?? 0.5, weight)
      : null;
    // Só recomenda trocar quando o melhor é OUTRO modelo E: (a) o atual está
    // inelegível/sem dado, ou (b) o melhor supera o atual por uma margem real.
    // Em empate (ex.: qualidade neutra no v1) o atual PREVALECE → sem "sugestão"
    // dirigida pela posição no array. Ver [[medicao-em-producao-mente-tres-modos]].
    const beatsCurrent =
      !!best &&
      best.slug !== currentSlug &&
      (currentScore == null || best.score > currentScore + SWITCH_MARGIN);
    const recommendedSlug = beatsCurrent ? best!.slug : null;
    // Custo do candidato só faz sentido quando HÁ recomendação (senão a UI
    // mostraria custo de um modelo que não estamos sugerindo).
    const recM = recommendedSlug ? market.get(recommendedSlug) : undefined;
    return {
      tier,
      currentSlug,
      recommendedSlug,
      reason: recommendedSlug
        ? currentScore == null
          ? "Atual indisponível/inelegível no mercado; melhor elegível sugerido (verificar no eval-gate antes de aplicar)."
          : "Melhor índice combinado supera o atual por margem real (verificar no eval-gate antes de aplicar)."
        : "Atual já é o melhor (ou empata) entre os elegíveis, ou dados insuficientes.",
      periodCostNow: curM ? estPeriodCost(curM, currentUsage) : null,
      periodCostRecommended: recM ? estPeriodCost(recM, currentUsage) : null,
    };
  });
}
