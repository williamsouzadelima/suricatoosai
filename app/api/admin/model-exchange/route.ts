import { NextRequest, NextResponse } from "next/server";
import { getSuperadminUser } from "@/lib/auth/require-superadmin";
import { getConvexClient } from "@/lib/db/convex-client";
import { api } from "@/convex/_generated/api";
import {
  CANDIDATES,
  CURRENT_ASSIGNMENT,
  UPSTREAM_ASSIGNMENT,
  TIER_LABELS,
  type MarketData,
  type OurUsage,
} from "@/lib/models/exchange";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "Pregão de LLMs" v1 — camada de REDE (leitura). Busca o mercado ao vivo do
 * OpenRouter (preço/contexto/tools/uptime/latência/throughput/provedores) para o
 * universo curado de candidatos e cruza com o NOSSO uso real por modelo
 * (usage_logs, via getCostAnalyticsForBackend.byModel). NÃO troca nada — a
 * recomendação (índice combinado) é recomputada no cliente a partir destes dados
 * (fonte única = lib/models/exchange.ts). Somente superadmin.
 */

const PERIODS = ["1h", "24h", "7d", "30d", "90d", "180d", "365d"] as const;
type Period = (typeof PERIODS)[number];

const OR_BASE = "https://openrouter.ai/api/v1";
const MARKET_TTL_MS = 5 * 60 * 1000; // cache do mercado (dados mudam devagar)
const FETCH_TIMEOUT_MS = 8000;

const CANDIDATE_SLUGS = new Set(CANDIDATES.map((c) => c.slug));

/**
 * usage_logs.model guarda o SLUG do OpenRouter (resolveModelName =
 * responseModel || configuredModelId), às vezes com sufixo de data
 * (ex.: "x-ai/grok-4.6-20260810"). Aliases explícitos evitam a colisão
 * "-0813" (candidato) vs "-20260813" (variante datada). Nomes internos
 * ("model-grok-4.6") entram como defesa caso alguma linha antiga os tenha.
 */
const SLUG_ALIASES: Record<string, string> = {
  "deepseek/deepseek-v4-flash-20260731": "deepseek/deepseek-v4-flash-0731",
  "deepseek/deepseek-v4-pro-20260813": "deepseek/deepseek-v4-pro-0813",
  "x-ai/grok-4.6-20260810": "x-ai/grok-4.6",
  "z-ai/glm-5.3-20260816": "z-ai/glm-5.3",
  "moonshotai/kimi-k3-20260715": "moonshotai/kimi-k3",
  // Nomes internos (defensivo; hoje o campo guarda slug).
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
  "model-glm-5.3": "z-ai/glm-5.3",
  "model-glm-5.3-flash": "z-ai/glm-5.3-flash",
  "ask-model-free": "z-ai/glm-5.3-flash",
  "model-kimi-k3": "moonshotai/kimi-k3",
  "model-opus-4.6": "moonshotai/kimi-k3",
};

function canonicalizeSlug(raw: string): string {
  if (SLUG_ALIASES[raw]) return SLUG_ALIASES[raw];
  const m = raw.match(/^(.+)-\d{8}$/); // variante datada -YYYYMMDD desconhecida
  if (m && CANDIDATE_SLUGS.has(m[1])) return m[1];
  return raw;
}

interface ModelsRow {
  id: string;
  pricing?: { prompt?: string; completion?: string };
  context_length?: number;
  supported_parameters?: string[];
  created?: number;
}
interface EndpointRow {
  supported_parameters?: string[];
  uptime_last_30m?: number | null;
  uptime_last_1d?: number | null;
  latency_last_30m?: number | null;
  throughput_last_30m?: number | null;
}

async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    const headers: Record<string, string> = { Accept: "application/json" };
    const key = process.env.OPENROUTER_API_KEY;
    if (key) headers.Authorization = `Bearer ${key}`;
    const res = await fetch(url, {
      headers,
      signal: ctrl.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null; // fail-open: mercado ausente vira campos null
  }
}

const numOrNull = (s: unknown): number | null => {
  const n = typeof s === "string" ? parseFloat(s) : typeof s === "number" ? s : NaN;
  return Number.isFinite(n) ? n : null;
};
const maxOf = (arr: (number | null)[]): number | null => {
  const v = arr.filter((x): x is number => x != null);
  return v.length ? Math.max(...v) : null;
};
const minPos = (arr: (number | null)[]): number | null => {
  const v = arr.filter((x): x is number => x != null && x > 0);
  return v.length ? Math.min(...v) : null;
};

let marketCache: { at: number; market: Record<string, MarketData> } | null = null;

async function loadMarket(): Promise<{
  market: Record<string, MarketData>;
  fetchedAt: number;
  degraded: boolean;
}> {
  if (marketCache && Date.now() - marketCache.at < MARKET_TTL_MS) {
    return { market: marketCache.market, fetchedAt: marketCache.at, degraded: false };
  }
  const modelsJson = (await fetchJson(`${OR_BASE}/models`)) as
    | { data?: ModelsRow[] }
    | null;
  const rows: ModelsRow[] = modelsJson?.data ?? [];
  const bySlug = new Map<string, ModelsRow>();
  for (const r of rows) if (r?.id) bySlug.set(r.id, r);

  const endpointResults = await Promise.all(
    CANDIDATES.map(async (c) => {
      const j = (await fetchJson(`${OR_BASE}/models/${c.slug}/endpoints`)) as
        | { data?: { endpoints?: EndpointRow[] } }
        | null;
      return [c.slug, j?.data?.endpoints ?? []] as const;
    }),
  );
  const epBySlug = new Map(endpointResults);

  const market: Record<string, MarketData> = {};
  let missing = 0;
  for (const c of CANDIDATES) {
    const m = bySlug.get(c.slug);
    const eps = epBySlug.get(c.slug) ?? [];
    if (!m) missing++;
    const supportsTools: boolean | null = m?.supported_parameters
      ? m.supported_parameters.includes("tools")
      : eps.length
        ? eps.some((e) => (e.supported_parameters ?? []).includes("tools"))
        : null;
    market[c.slug] = {
      slug: c.slug,
      priceIn: numOrNull(m?.pricing?.prompt),
      priceOut: numOrNull(m?.pricing?.completion),
      contextLength: typeof m?.context_length === "number" ? m.context_length : null,
      uptime30m: maxOf(eps.map((e) => numOrNull(e.uptime_last_30m))),
      uptime1d: maxOf(eps.map((e) => numOrNull(e.uptime_last_1d))),
      latencyMs: minPos(eps.map((e) => numOrNull(e.latency_last_30m))),
      throughput: maxOf(eps.map((e) => numOrNull(e.throughput_last_30m))),
      providerCount: eps.length,
      supportsTools,
      createdIso:
        typeof m?.created === "number"
          ? new Date(m.created * 1000).toISOString().slice(0, 10)
          : null,
    };
  }
  // "degraded" = a lista de modelos não veio (sem preço p/ ninguém). Endpoints
  // podem falhar individualmente sem degradar (uptime/latência viram null).
  const degraded = !modelsJson || missing === CANDIDATES.length;
  const fetchedAt = Date.now();
  if (!degraded) marketCache = { at: fetchedAt, market };
  return { market, fetchedAt, degraded };
}

export async function GET(req: NextRequest) {
  const admin = await getSuperadminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const serviceKey = process.env.CONVEX_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return NextResponse.json(
      { error: "Server not configured (CONVEX_SERVICE_ROLE_KEY)" },
      { status: 500 },
    );
  }

  const url = new URL(req.url);
  const periodParam = url.searchParams.get("period");
  const period: Period = PERIODS.includes(periodParam as Period)
    ? (periodParam as Period)
    : "30d";

  // Nosso uso real por modelo (fail-open: sem uso vira lista vazia).
  const usageBySlug: Record<string, OurUsage> = {};
  let usageDegraded = false; // Convex indisponível ≠ "período sem uso".
  try {
    const data = await getConvexClient().query(
      api.adminUsers.getCostAnalyticsForBackend,
      { serviceKey, period, nowMs: Date.now() },
    );
    for (const r of data.byModel) {
      const slug = canonicalizeSlug(r.model);
      const prev = usageBySlug[slug];
      if (prev) {
        prev.requests += r.requests;
        prev.costDollars += r.realCost;
        prev.outputTokens += r.outputTokens;
      } else {
        usageBySlug[slug] = {
          slug,
          requests: r.requests,
          costDollars: r.realCost,
          outputTokens: r.outputTokens,
        };
      }
    }
  } catch {
    // Convex fora: NÃO é "sem uso" — sinaliza p/ a UI não afirmar zero.
    usageDegraded = true;
  }

  const { market, fetchedAt, degraded } = await loadMarket();

  return NextResponse.json({
    generatedAt: fetchedAt,
    period,
    degraded,
    usageDegraded,
    currentAssignment: CURRENT_ASSIGNMENT,
    upstreamAssignment: UPSTREAM_ASSIGNMENT,
    tierLabels: TIER_LABELS,
    candidates: CANDIDATES.map((c) => ({
      slug: c.slug,
      label: c.label,
      family: c.family,
      jurisdiction: c.jurisdiction,
      tiers: c.tiers,
      market: market[c.slug] ?? null,
      ourUsage: usageBySlug[c.slug] ?? null,
    })),
  });
}
