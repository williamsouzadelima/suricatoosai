import { NextRequest, NextResponse } from "next/server";
import { getSuperadminUser } from "@/lib/auth/require-superadmin";
import { getConvexClient } from "@/lib/db/convex-client";
import { api } from "@/convex/_generated/api";
import { CANDIDATES, canonicalizeModelSlug } from "@/lib/models/exchange";
import { decidePerTier } from "@/lib/models/decision";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Eval-gate Fase A (read-only) — medição de QUALIDADE por modelo SERVIDO.
 * DUAS queries na MESMA base de atribuição (modelo servido = messages.model):
 *  - getModelQualityForBackend: latência p50/p95, finish_reason, achados
 *    validados/descartados/pendentes;
 *  - getServedModelCostForBackend: custo real atribuído pelo modelo servido
 *    (usage_logs.assistant_message_id → messages.model), NÃO por usage_logs.model
 *    (que vira "auto" no braço auto). Assim custo e qualidade são comparáveis.
 * Ambos canonicalizados p/ o slug do candidato. NÃO toca o hot-path. Superadmin.
 */

const PERIODS = ["1h", "24h", "7d", "30d", "90d", "180d", "365d"] as const;
type Period = (typeof PERIODS)[number];

interface FinishReason {
  reason: string;
  count: number;
}
interface QualityRow {
  model: string;
  assistantMessages: number;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  finishReasons: FinishReason[];
  findingsValidated: number;
  findingsDismissed: number;
  findingsPending: number;
  toolCalls: number;
  toolErrors: number;
}
interface CostRow {
  model: string;
  realCost: number;
  requests: number;
  outputTokens: number;
  billedCost: number;
  billedRequests: number;
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

  const nowMs = Date.now();
  const client = getConvexClient();

  const [quality, cost] = await Promise.all([
    client
      .query(api.adminUsers.getModelQualityForBackend, {
        serviceKey,
        period,
        nowMs,
      })
      .catch(() => null),
    client
      .query(api.adminUsers.getServedModelCostForBackend, {
        serviceKey,
        period,
        nowMs,
      })
      .catch(() => null),
  ]);

  // Qualidade por candidato (canonicaliza messages.model → slug do candidato).
  type Q = {
    assistantMessages: number;
    latencyP50Ms: number | null;
    latencyP95Ms: number | null;
    latencyFromMsgs: number; // volume do slug bruto que forneceu a latência
    finishReasons: Map<string, number>;
    findingsValidated: number;
    findingsDismissed: number;
    findingsPending: number;
    toolCalls: number;
    toolErrors: number;
  };
  const qualityBySlug = new Map<string, Q>();
  for (const r of (quality?.byModel ?? []) as QualityRow[]) {
    const slug = canonicalizeModelSlug(r.model);
    const prev = qualityBySlug.get(slug);
    if (prev) {
      prev.assistantMessages += r.assistantMessages;
      prev.findingsValidated += r.findingsValidated;
      prev.findingsDismissed += r.findingsDismissed;
      prev.findingsPending += r.findingsPending;
      prev.toolCalls += r.toolCalls;
      prev.toolErrors += r.toolErrors;
      for (const f of r.finishReasons) {
        prev.finishReasons.set(
          f.reason,
          (prev.finishReasons.get(f.reason) ?? 0) + f.count,
        );
      }
      // Latência: sem os valores brutos não dá p/ recomputar o percentil na
      // colisão (raro); mantém a do slug bruto MAIS VOLUMOSO, comparando contra
      // o volume que a latência atual representa (não contra o total corrente).
      if (r.assistantMessages > prev.latencyFromMsgs) {
        prev.latencyP50Ms = r.latencyP50Ms;
        prev.latencyP95Ms = r.latencyP95Ms;
        prev.latencyFromMsgs = r.assistantMessages;
      }
    } else {
      qualityBySlug.set(slug, {
        assistantMessages: r.assistantMessages,
        latencyP50Ms: r.latencyP50Ms,
        latencyP95Ms: r.latencyP95Ms,
        latencyFromMsgs: r.assistantMessages,
        finishReasons: new Map(r.finishReasons.map((f) => [f.reason, f.count])),
        findingsValidated: r.findingsValidated,
        findingsDismissed: r.findingsDismissed,
        findingsPending: r.findingsPending,
        toolCalls: r.toolCalls,
        toolErrors: r.toolErrors,
      });
    }
  }

  // Custo real por candidato — MESMA base (modelo servido).
  const costBySlug = new Map<
    string,
    {
      realCost: number;
      requests: number;
      outputTokens: number;
      billedCost: number;
      billedRequests: number;
    }
  >();
  for (const r of (cost?.byModel ?? []) as CostRow[]) {
    const slug = canonicalizeModelSlug(r.model);
    const prev = costBySlug.get(slug);
    if (prev) {
      prev.realCost += r.realCost;
      prev.requests += r.requests;
      prev.outputTokens += r.outputTokens;
      prev.billedCost += r.billedCost;
      prev.billedRequests += r.billedRequests;
    } else {
      costBySlug.set(slug, {
        realCost: r.realCost,
        requests: r.requests,
        outputTokens: r.outputTokens,
        billedCost: r.billedCost,
        billedRequests: r.billedRequests,
      });
    }
  }

  // Observabilidade (achado #10): tráfego servido sob slug canônico que NÃO é
  // candidato some da comparação. Não deve derrubar a decisão (é fail-safe: só
  // subconta), mas logamos p/ caçar alias faltante em MODEL_SLUG_ALIASES.
  const candidateSlugs = new Set(CANDIDATES.map((c) => c.slug));
  const nonCandidate = new Set<string>();
  for (const s of qualityBySlug.keys())
    if (!candidateSlugs.has(s)) nonCandidate.add(s);
  for (const s of costBySlug.keys())
    if (!candidateSlugs.has(s)) nonCandidate.add(s);
  if (nonCandidate.size > 0) {
    console.warn(
      `[model-quality] tráfego sob slug(s) não-candidato ignorado na comparação: ${[...nonCandidate].join(", ")} — adicione alias em MODEL_SLUG_ALIASES ou candidato em CANDIDATES.`,
    );
  }

  const rows = CANDIDATES.map((c) => {
    const q = qualityBySlug.get(c.slug);
    const co = costBySlug.get(c.slug);
    return {
      slug: c.slug,
      label: c.label,
      family: c.family,
      jurisdiction: c.jurisdiction,
      assistantMessages: q?.assistantMessages ?? 0,
      latencyP50Ms: q?.latencyP50Ms ?? null,
      latencyP95Ms: q?.latencyP95Ms ?? null,
      finishReasons: q
        ? Array.from(q.finishReasons.entries())
            .map(([reason, count]) => ({ reason, count }))
            .sort((a, b) => b.count - a.count)
        : [],
      findingsValidated: q?.findingsValidated ?? 0,
      findingsDismissed: q?.findingsDismissed ?? 0,
      findingsPending: q?.findingsPending ?? 0,
      toolCalls: q?.toolCalls ?? 0,
      toolErrors: q?.toolErrors ?? 0,
      realCost: co?.realCost ?? 0,
      requests: co?.requests ?? 0,
      outputTokens: co?.outputTokens ?? 0,
      billedCost: co?.billedCost ?? 0,
      billedRequests: co?.billedRequests ?? 0,
      hasData: !!q || !!co,
    };
  });

  // Camada de DECISÃO (fecha o A/B): verdito por tier a partir das MESMAS linhas
  // medidas. Só recomenda com significância; abaixo da amostra diz "insuficiente".
  // Passa as flags de INDISPONIBILIDADE p/ distinguir "falha de leitura" de "zero
  // medido" (achado #9) — sem isso, uma query que falha viraria "0 msgs / rode mais".
  const decisions = decidePerTier(rows, {
    qualityUnavailable: quality == null,
    costUnavailable: cost == null,
  });

  return NextResponse.json({
    generatedAt: nowMs,
    period,
    messagesCapped: quality?.messagesCapped ?? false,
    findingsCapped:
      (quality?.findingsCapped ?? false) ||
      (quality?.findingsLookupCapped ?? false),
    usageCapped:
      (cost?.usageCapped ?? false) || (cost?.lookupCapped ?? false),
    unattributedCostDollars: cost?.unattributedCostDollars ?? 0,
    qualityUnavailable: quality == null,
    costUnavailable: cost == null,
    decisions,
    rows,
  });
}
