"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeftRight,
  Scale,
  RefreshCw,
  Cpu,
  Gauge,
  Wrench,
  Check,
  X,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SectionHeader, Callout, EmptyState, formatDateTime } from "./_ui";
import {
  blendedIndex,
  isEligible,
  recommendPerTier,
  type MarketData,
  type OurUsage,
  type TierId,
  type TierRecommendation,
} from "@/lib/models/exchange";

const PERIODS: { key: Period; label: string }[] = [
  { key: "7d", label: "7d" },
  { key: "30d", label: "30d" },
  { key: "90d", label: "3m" },
  { key: "180d", label: "6m" },
  { key: "365d", label: "1a" },
];
type Period = "1h" | "24h" | "7d" | "30d" | "90d" | "180d" | "365d";

interface CandidateRow {
  slug: string;
  label: string;
  family: string;
  jurisdiction: "US" | "China" | "EU" | "Other";
  tiers: TierId[];
  market: MarketData | null;
  ourUsage: OurUsage | null;
}
interface ExchangeData {
  generatedAt: number;
  period: Period;
  degraded: boolean;
  usageDegraded: boolean;
  currentAssignment: Record<TierId, string>;
  upstreamAssignment: Record<TierId, string>;
  tierLabels: Record<TierId, string>;
  candidates: CandidateRow[];
}

/** $ por 1M tokens a partir do preço por-token do OpenRouter. */
function perM(price: number | null | undefined): string {
  if (price == null || !Number.isFinite(price)) return "—";
  return `$${(price * 1e6).toFixed(2)}`;
}
function usd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `$${n >= 1 ? n.toFixed(2) : n.toFixed(4)}`;
}
function pct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(1)}%`;
}
function ctx(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${Math.round(n / 1000)}k`;
}

const JURIS_TONE: Record<string, string> = {
  US: "bg-chart-1/15 text-chart-1",
  China: "bg-amber-500/15 text-amber-500",
  EU: "bg-chart-2/15 text-chart-2",
  Other: "bg-muted text-muted-foreground",
};

export function ModelExchangePanel() {
  const [period, setPeriod] = useState<Period>("30d");
  const [weight, setWeight] = useState(0.5); // 0 = só custo, 1 = só qualidade
  const [data, setData] = useState<ExchangeData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/model-exchange?period=${period}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (e) {
      toast.error("Falha ao carregar o pregão de LLMs.");
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    void load();
  }, [load]);

  // Mapas p/ recomputar índice/recomendação no cliente (fonte única = exchange.ts).
  const market = useMemo(() => {
    const m = new Map<string, MarketData>();
    for (const c of data?.candidates ?? []) if (c.market) m.set(c.slug, c.market);
    return m;
  }, [data]);
  const usage = useMemo(() => {
    const m = new Map<string, OurUsage>();
    for (const c of data?.candidates ?? []) if (c.ourUsage) m.set(c.slug, c.ourUsage);
    return m;
  }, [data]);
  const slugToLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of data?.candidates ?? []) m.set(c.slug, c.label);
    return m;
  }, [data]);

  const recommendations = useMemo<TierRecommendation[]>(() => {
    if (!data) return [];
    return recommendPerTier(market, usage, new Map(), weight);
  }, [data, market, usage, weight]);

  // Linhas ordenadas por índice combinado (desc).
  const rows = useMemo(() => {
    const list = (data?.candidates ?? []).map((c) => ({
      ...c,
      index: c.market ? blendedIndex(c.market, 0.5, weight) : null,
      eligible: isEligible(c.market ?? undefined),
    }));
    return list.sort((a, b) => (b.index ?? -1) - (a.index ?? -1));
  }, [data, weight]);

  const grok46 = data?.candidates.find((c) => c.slug === "x-ai/grok-4.6");
  const grok47 = data?.candidates.find((c) => c.slug === "x-ai/grok-4.7");

  return (
    <Card className="gap-0 py-0">
      {/* Controles */}
      <div className="flex flex-col gap-3 border-b p-5 lg:flex-row lg:items-center lg:justify-between">
        <SectionHeader
          icon={ArrowLeftRight}
          title="Pregão de LLMs"
          description="Mercado ao vivo (OpenRouter) × nosso uso real. Lê e recomenda — não troca nada."
        />
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-lg border bg-muted/40 p-0.5">
            {PERIODS.map((p) => (
              <button
                key={p.key}
                onClick={() => setPeriod(p.key)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium tabular-nums transition-colors",
                  period === p.key
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Scale className="h-4 w-4 text-muted-foreground" />
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={weight}
              onChange={(e) => setWeight(parseFloat(e.target.value))}
              className="h-1.5 w-28 cursor-pointer accent-[var(--primary)]"
              aria-label="Peso qualidade vs custo"
            />
            <span className="w-24 text-xs tabular-nums text-muted-foreground">
              {Math.round((1 - weight) * 100)}% custo
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load()}
            disabled={loading}
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            Atualizar
          </Button>
        </div>
      </div>

      <CardContent className="space-y-5 p-5">
        <Callout tone="neutral">
          <strong>v1 — leitura e recomendação.</strong> Nada é trocado
          automaticamente. A qualidade entra <strong>neutra (50%)</strong> aqui;
          o A/B real de qualidade (achados, uso de ferramenta) é o{" "}
          <strong>eval-gate v2</strong>. Custo real por modelo só existe para
          execuções pós-09/09/2026. Mercado do OpenRouter, cache de 5&nbsp;min.
        </Callout>

        {data?.degraded && (
          <Callout tone="warning">
            Não consegui buscar o mercado do OpenRouter agora — preços/uptime
            aparecem como “—”. O nosso uso real ainda é exibido.
          </Callout>
        )}

        {data?.usageDegraded && (
          <Callout tone="warning">
            Não consegui carregar o <strong>nosso uso real</strong> agora (Convex
            indisponível) — as colunas “Nosso uso” e as projeções de custo estão{" "}
            <strong>indisponíveis, não zeradas</strong>. Atualize em instantes.
          </Callout>
        )}

        {/* Foco: Grok 4.6 (atual) vs Grok 4.7 (candidato) */}
        <div className="rounded-xl border p-4">
          <div className="mb-3">
            <SectionHeader
              icon={TrendingDown}
              title="Foco: Grok 4.6 (atual) → Grok 4.7 (candidato)"
              description="O A/B pedido. Comparação de mercado + projeção do nosso volume no candidato."
            />
          </div>
          {loading || !grok46 || !grok47 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              {loading ? "Carregando…" : "Modelos não encontrados no catálogo."}
            </div>
          ) : (
            <VsGrok
              a={grok46}
              b={grok47}
              usageDegraded={data?.usageDegraded ?? false}
            />
          )}
        </div>

        {/* Recomendação por tier */}
        <div className="grid gap-4 lg:grid-cols-3">
          {loading || !data ? (
            <div className="col-span-full py-8 text-center text-sm text-muted-foreground">
              Carregando…
            </div>
          ) : (
            recommendations.map((r) => (
              <TierCard
                key={r.tier}
                rec={r}
                tierLabel={data.tierLabels[r.tier]}
                currentLabel={slugToLabel.get(r.currentSlug) ?? r.currentSlug}
                recommendedLabel={
                  r.recommendedSlug
                    ? (slugToLabel.get(r.recommendedSlug) ?? r.recommendedSlug)
                    : null
                }
              />
            ))
          )}
        </div>

        {/* Tabela de mercado */}
        <div className="rounded-xl border p-4">
          <div className="mb-3">
            <SectionHeader
              icon={Cpu}
              title="Mercado × nosso uso"
              description={
                data
                  ? `Atualizado ${formatDateTime(data.generatedAt)} · índice = custo×qualidade (peso ${Math.round((1 - weight) * 100)}% custo)`
                  : undefined
              }
              count={rows.length}
            />
          </div>
          {loading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Carregando…
            </div>
          ) : rows.length === 0 ? (
            <EmptyState icon={Cpu} title="Sem candidatos." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Modelo</th>
                    <th className="px-2 py-2 text-right font-medium">$in/M</th>
                    <th className="px-2 py-2 text-right font-medium">$out/M</th>
                    <th className="px-2 py-2 text-right font-medium">Contexto</th>
                    <th className="px-2 py-2 text-center font-medium">Tools</th>
                    <th className="px-2 py-2 text-right font-medium">Uptime</th>
                    <th className="px-2 py-2 text-right font-medium">Prov.</th>
                    <th className="px-2 py-2 text-right font-medium">
                      Nosso uso
                    </th>
                    <th className="px-2 py-2 text-right font-medium">Índice</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => {
                    const isCurrent = data
                      ? Object.values(data.currentAssignment).includes(c.slug)
                      : false;
                    return (
                      <tr
                        key={c.slug}
                        className={cn(
                          "border-b border-border/60 last:border-0",
                          !c.eligible && "opacity-55",
                        )}
                      >
                        <td className="py-2 pr-3">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{c.label}</span>
                            {isCurrent && (
                              <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                                em uso
                              </span>
                            )}
                            <span
                              className={cn(
                                "rounded px-1.5 py-0.5 text-[10px] font-medium",
                                JURIS_TONE[c.jurisdiction] ?? JURIS_TONE.Other,
                              )}
                            >
                              {c.jurisdiction}
                            </span>
                          </div>
                          <div className="font-mono text-[10px] text-muted-foreground">
                            {c.slug}
                          </div>
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">
                          {perM(c.market?.priceIn)}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums">
                          {perM(c.market?.priceOut)}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">
                          {ctx(c.market?.contextLength)}
                        </td>
                        <td className="px-2 py-2 text-center">
                          {c.market?.supportsTools === true ? (
                            <Check className="mx-auto h-4 w-4 text-emerald-500" />
                          ) : c.market?.supportsTools === false ? (
                            <X className="mx-auto h-4 w-4 text-destructive" />
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td
                          className={cn(
                            "px-2 py-2 text-right tabular-nums",
                            c.market?.uptime30m != null &&
                              c.market.uptime30m < 95 &&
                              "text-destructive",
                          )}
                        >
                          {pct(c.market?.uptime30m)}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">
                          {c.market?.providerCount ?? "—"}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums">
                          {c.ourUsage ? (
                            <span>
                              {usd(c.ourUsage.costDollars)}
                              <span className="ml-1 text-xs text-muted-foreground">
                                · {c.ourUsage.requests}r
                              </span>
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-2 py-2 text-right">
                          <IndexPill value={c.index} eligible={c.eligible} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function IndexPill({
  value,
  eligible,
}: {
  value: number | null;
  eligible: boolean;
}) {
  if (value == null)
    return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <span
      className={cn(
        "inline-block min-w-[2.5rem] rounded-md px-2 py-0.5 text-xs font-semibold tabular-nums",
        !eligible
          ? "bg-muted text-muted-foreground"
          : value >= 66
            ? "bg-emerald-500/15 text-emerald-500"
            : value >= 40
              ? "bg-amber-500/15 text-amber-500"
              : "bg-destructive/15 text-destructive",
      )}
      title={eligible ? undefined : "Inelegível (uptime baixo / sem tools / sem preço)"}
    >
      {value}
    </span>
  );
}

function TierCard({
  rec,
  tierLabel,
  currentLabel,
  recommendedLabel,
}: {
  rec: TierRecommendation;
  tierLabel: string;
  currentLabel: string;
  recommendedLabel: string | null;
}) {
  const cheaper =
    rec.periodCostNow != null &&
    rec.periodCostRecommended != null &&
    rec.periodCostRecommended < rec.periodCostNow;
  const delta =
    rec.periodCostNow != null && rec.periodCostRecommended != null
      ? rec.periodCostRecommended - rec.periodCostNow
      : null;
  return (
    <div className="flex flex-col rounded-xl border p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {tierLabel}
        </span>
        {recommendedLabel ? (
          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-500">
            sugestão
          </span>
        ) : (
          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-500">
            manter
          </span>
        )}
      </div>
      <div className="text-sm">
        <span className="text-muted-foreground">Atual: </span>
        <span className="font-medium">{currentLabel}</span>
      </div>
      {recommendedLabel && (
        <div className="mt-1 flex items-center gap-1 text-sm">
          <ArrowLeftRight className="h-3.5 w-3.5 text-amber-500" />
          <span className="font-semibold text-amber-500">{recommendedLabel}</span>
        </div>
      )}
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg bg-muted/40 p-2">
          <div className="text-muted-foreground">Saída × preço · atual</div>
          <div className="tabular-nums font-medium">{usd(rec.periodCostNow)}</div>
        </div>
        <div className="rounded-lg bg-muted/40 p-2">
          <div className="text-muted-foreground">Saída × preço · candidato</div>
          <div
            className={cn(
              "flex items-center gap-1 tabular-nums font-medium",
              cheaper ? "text-emerald-500" : delta != null && delta > 0 && "text-destructive",
            )}
          >
            {usd(rec.periodCostRecommended)}
            {delta != null &&
              (cheaper ? (
                <TrendingDown className="h-3 w-3" />
              ) : delta > 0 ? (
                <TrendingUp className="h-3 w-3" />
              ) : null)}
          </div>
        </div>
      </div>
      <p className="mt-2 text-[10px] leading-snug text-muted-foreground">
        Base: só tokens de <strong>saída</strong> da janela × preço de lista do
        OpenRouter — compara <em>preço</em>, não é o custo real faturado (esse
        está em “Nosso uso” na tabela).
      </p>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        {rec.reason}
      </p>
    </div>
  );
}

function VsCell({
  label,
  va,
  vb,
  hint,
}: {
  label: string;
  va: string;
  vb: string;
  hint?: string;
}) {
  return (
    <div className="grid grid-cols-3 items-center gap-2 border-b border-border/50 py-1.5 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-right text-sm tabular-nums">{va}</span>
      <span className="text-right text-sm font-medium tabular-nums">
        {vb}
        {hint && <span className="ml-1 text-[10px] text-emerald-500">{hint}</span>}
      </span>
    </div>
  );
}

function VsGrok({
  a,
  b,
  usageDegraded,
}: {
  a: CandidateRow;
  b: CandidateRow;
  usageDegraded: boolean;
}) {
  const ma = a.market;
  const mb = b.market;
  const deltaOut =
    ma?.priceOut != null && mb?.priceOut != null && ma.priceOut > 0
      ? ((mb.priceOut - ma.priceOut) / ma.priceOut) * 100
      : null;
  // Projeção: nosso volume de saída no 4.6 aplicado ao preço de saída do 4.7.
  const ourOut = a.ourUsage?.outputTokens ?? 0;
  const projA = ma?.priceOut != null ? ourOut * ma.priceOut : null;
  const projB = mb?.priceOut != null ? ourOut * mb.priceOut : null;
  const saving = projA != null && projB != null ? projA - projB : null;

  return (
    <div>
      <div className="grid grid-cols-3 gap-2 border-b pb-2 text-xs font-semibold">
        <span className="text-muted-foreground">Métrica</span>
        <span className="text-right">{a.label}</span>
        <span className="text-right">
          {b.label}
          <span className="ml-1 rounded bg-amber-500/15 px-1 py-0.5 text-[10px] font-semibold text-amber-500">
            candidato
          </span>
        </span>
      </div>
      <VsCell label="Entrada $/M" va={perM(ma?.priceIn)} vb={perM(mb?.priceIn)} />
      <VsCell
        label="Saída $/M"
        va={perM(ma?.priceOut)}
        vb={perM(mb?.priceOut)}
        hint={deltaOut != null && deltaOut < 0 ? `${deltaOut.toFixed(0)}%` : undefined}
      />
      <VsCell label="Contexto" va={ctx(ma?.contextLength)} vb={ctx(mb?.contextLength)} />
      <VsCell label="Uptime 30m" va={pct(ma?.uptime30m)} vb={pct(mb?.uptime30m)} />
      <VsCell
        label="Tools"
        va={ma?.supportsTools ? "sim" : ma?.supportsTools === false ? "não" : "—"}
        vb={mb?.supportsTools ? "sim" : mb?.supportsTools === false ? "não" : "—"}
      />
      <VsCell
        label="Nosso gasto real (período)"
        va={usd(a.ourUsage?.costDollars)}
        vb="—"
      />
      <VsCell
        label="Projeção do nosso volume de saída"
        va={usd(projA)}
        vb={usd(projB)}
        hint={saving != null && saving > 0 ? `−${usd(saving)}` : undefined}
      />
      {ourOut === 0 &&
        (usageDegraded ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Uso real não carregado agora (Convex indisponível) — a projeção
            aparece quando os dados voltarem. Não é zero.
          </p>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">
            Sem volume de saída atribuído ao Grok 4.6 nesta janela — a projeção
            aparece quando houver uso real (custo real só pós-09/09).
          </p>
        ))}
    </div>
  );
}
