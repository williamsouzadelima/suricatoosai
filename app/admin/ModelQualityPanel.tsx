"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Gauge,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  ArrowLeftRight,
  ShieldCheck,
  CircleDashed,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SectionHeader, Callout, EmptyState, formatDateTime } from "./_ui";
import {
  MIN_CURATED,
  MIN_TOOLCALLS,
  type TierDecision,
  type MetricComparison,
  type RateStat,
} from "@/lib/models/decision";

const PERIODS: { key: Period; label: string }[] = [
  { key: "7d", label: "7d" },
  { key: "30d", label: "30d" },
  { key: "90d", label: "3m" },
  { key: "180d", label: "6m" },
  { key: "365d", label: "1a" },
];
type Period = "1h" | "24h" | "7d" | "30d" | "90d" | "180d" | "365d";

interface FinishReason {
  reason: string;
  count: number;
}
interface QualityRow {
  slug: string;
  label: string;
  family: string;
  jurisdiction: "US" | "China" | "EU" | "Other";
  assistantMessages: number;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  finishReasons: FinishReason[];
  findingsValidated: number;
  findingsDismissed: number;
  findingsPending: number;
  toolCalls: number;
  toolErrors: number;
  realCost: number;
  requests: number;
  outputTokens: number;
  billedCost: number;
  billedRequests: number;
  hasData: boolean;
}
interface QualityData {
  generatedAt: number;
  period: Period;
  messagesCapped: boolean;
  findingsCapped: boolean;
  usageCapped: boolean;
  unattributedCostDollars: number;
  qualityUnavailable: boolean;
  costUnavailable: boolean;
  decisions: TierDecision[];
  rows: QualityRow[];
}

function usd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `$${n >= 1 ? n.toFixed(2) : n.toFixed(4)}`;
}
function ms(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n < 1000 ? `${Math.round(n)}ms` : `${(n / 1000).toFixed(1)}s`;
}
/** Taxa de validação = validados / (validados + descartados). Pendentes fora. */
function validationRate(v: number, d: number): number | null {
  const denom = v + d;
  return denom > 0 ? v / denom : null;
}
/** Tool-success = (calls - errors) / calls. Sucesso de EXECUÇÃO da tool (não
 *  semântico — shell exit≠0 conta como sucesso de execução). */
function toolSuccessRate(calls: number, errors: number): number | null {
  return calls > 0 ? (calls - errors) / calls : null;
}

const JURIS_TONE: Record<string, string> = {
  US: "bg-chart-1/15 text-chart-1",
  China: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  EU: "bg-chart-2/15 text-chart-2",
  Other: "bg-muted text-muted-foreground",
};

function fmtStat(s: RateStat | null): string {
  return s ? `${Math.round(s.rate * 100)}%` : "—";
}

const VERDICT_META: Record<
  TierDecision["verdict"],
  { label: string; icon: typeof ArrowLeftRight; tone: string }
> = {
  switch: {
    label: "Trocar",
    icon: ArrowLeftRight,
    tone: "border-amber-500/30 bg-amber-500/15 text-amber-600 dark:text-amber-400",
  },
  keep: {
    label: "Manter",
    icon: ShieldCheck,
    tone: "border-emerald-500/30 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  },
  insufficient: {
    label: "Sem amostra",
    icon: CircleDashed,
    tone: "border-border bg-muted text-muted-foreground",
  },
};

type WinSide = "cur" | "cand" | "none";
function cellTone(side: "cur" | "cand", winner: WinSide): string {
  return side === winner
    ? "font-semibold text-foreground"
    : "text-muted-foreground";
}

/** Comparação lado-a-lado atual × desafiante, com destaque no vencedor por métrica. */
function CompareGrid({
  cmp,
  currentLabel,
  challengerLabel,
}: {
  cmp: MetricComparison;
  currentLabel: string;
  challengerLabel: string;
}) {
  const qWin: WinSide =
    cmp.qualityCmp === "cand_better"
      ? "cand"
      : cmp.qualityCmp === "cur_better"
        ? "cur"
        : "none";
  const tWin: WinSide =
    cmp.toolCmp === "cand_better"
      ? "cand"
      : cmp.toolCmp === "cur_better"
        ? "cur"
        : "none";
  const cWin: WinSide =
    cmp.costCmp === "cand_cheaper"
      ? "cand"
      : cmp.costCmp === "cur_cheaper"
        ? "cur"
        : "none";
  // Latência NÃO tem IC nem margem e o núcleo não a usa no veredito — é apenas
  // informativa. Nunca destacar "vencedor" aqui (achado #11): destaque só para
  // métricas com veredito estatístico (validação/tool/custo).
  const gridRows: { k: string; cur: string; cand: string; win: WinSide }[] = [
    {
      k: "Validação",
      cur: fmtStat(cmp.curValidation),
      cand: fmtStat(cmp.candValidation),
      win: qWin,
    },
    {
      k: "Tool-sucesso",
      cur: fmtStat(cmp.curTool),
      cand: fmtStat(cmp.candTool),
      win: tWin,
    },
    {
      k: "Custo/req",
      cur: usd(cmp.curCostPerReq),
      cand: usd(cmp.candCostPerReq),
      win: cWin,
    },
    {
      k: "Latência p50",
      cur: ms(cmp.curLatencyMs),
      cand: ms(cmp.candLatencyMs),
      win: "none", // informativa — sem destaque de vencedor (achado #11)
    },
  ];
  // Trilhas de coluna FIXAS e compartilhadas entre cabeçalho e linhas, para que
  // atual/desafiante alinhem verticalmente (achado #16).
  const cols = "grid grid-cols-[1fr_64px_64px] gap-x-3";
  return (
    <div className="mt-3 overflow-hidden rounded-md border">
      <div
        className={cn(
          cols,
          "border-b bg-muted/40 px-2.5 py-1.5 text-[10px] font-medium text-muted-foreground",
        )}
      >
        <span>Métrica</span>
        <span className="truncate text-right" title={currentLabel}>
          {currentLabel}
        </span>
        <span className="truncate text-right" title={challengerLabel}>
          {challengerLabel}
        </span>
      </div>
      {gridRows.map((r) => (
        <div key={r.k} className={cn(cols, "px-2.5 py-1 text-xs tabular-nums")}>
          <span className="text-muted-foreground">{r.k}</span>
          <span className={cn("text-right", cellTone("cur", r.win))}>
            {r.cur}
          </span>
          <span className={cn("text-right", cellTone("cand", r.win))}>
            {r.cand}
          </span>
        </div>
      ))}
    </div>
  );
}

function DecisionCards({ decisions }: { decisions: TierDecision[] }) {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {decisions.map((d) => {
        const meta = VERDICT_META[d.verdict];
        const Icon = meta.icon;
        return (
          <div key={d.tier} className="rounded-lg border bg-card p-3.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {d.tierLabel}
              </span>
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium",
                  meta.tone,
                )}
              >
                <Icon className="h-3 w-3" />
                {meta.label}
              </span>
            </div>
            <div className="mt-1.5 text-sm font-medium">
              {d.verdict === "switch" && d.challengerLabel ? (
                <span className="inline-flex flex-wrap items-center gap-1.5">
                  <span className="text-muted-foreground line-through decoration-muted-foreground/40">
                    {d.currentLabel}
                  </span>
                  <ArrowLeftRight className="h-3.5 w-3.5 text-amber-500" />
                  <span>{d.challengerLabel}</span>
                </span>
              ) : (
                <span>{d.currentLabel}</span>
              )}
            </div>
            <p className="mt-1.5 text-xs leading-snug text-muted-foreground">
              {d.reason}
            </p>
            {d.comparison && (
              <CompareGrid
                cmp={d.comparison}
                currentLabel={d.currentLabel}
                challengerLabel={d.challengerLabel ?? "—"}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

export function ModelQualityPanel() {
  const [period, setPeriod] = useState<Period>("30d");
  const [data, setData] = useState<QualityData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/model-quality?period=${period}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (e) {
      toast.error("Falha ao carregar a comparação de modelos.");
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = (data?.rows ?? [])
    .slice()
    .sort((a, b) => b.assistantMessages - a.assistantMessages);

  return (
    <Card className="gap-0 py-0">
      <div className="flex flex-col gap-3 border-b p-5 lg:flex-row lg:items-center lg:justify-between">
        <SectionHeader
          icon={Gauge}
          title="Comparar modelos — decisão + qualidade real (eval-gate)"
          description="Recomendação por tier com significância + medição por modelo SERVIDO (custo, achados, tool-sucesso, latência). Read-only."
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
          <strong>As 4 métricas por modelo servido.</strong> Atribuição pelo
          modelo <strong>servido</strong> (reflete fallback). Qualidade ={" "}
          <strong>achados validados</strong> (aprovados/publicados na curadoria),
          nunca o veredito auto-declarado. <strong>Tool-sucesso</strong> = a tool
          executou sem lançar (confiabilidade de tool-calling, não sucesso
          semântico); só conta em runs pós-instrumentação. Custo real só
          pós-09/09; achado/tools capturados em fallback sub-atribuem ao modelo
          primário.
        </Callout>

        {data?.qualityUnavailable && (
          <Callout tone="warning">
            Não consegui carregar a medição de qualidade agora — latência e
            achados por modelo estão indisponíveis (não zerados).
          </Callout>
        )}
        {data?.costUnavailable && (
          <Callout tone="warning">
            Não consegui carregar os custos agora — a coluna “Custo real” está
            indisponível (não zerada).
          </Callout>
        )}
        {(data?.messagesCapped || data?.findingsCapped || data?.usageCapped) && (
          <Callout tone="warning">
            Teto de leitura atingido na janela — os números são um{" "}
            <strong>limite inferior</strong> sobre as linhas mais recentes.
          </Callout>
        )}
        {!!data && data.unattributedCostDollars > 0.01 && (
          <Callout tone="neutral">
            <strong>{usd(data.unattributedCostDollars)}</strong> de custo real
            no período <strong>não foi atribuído</strong> a nenhum modelo (linhas
            de uso sem mensagem resolvível). Não está somado às linhas abaixo.
          </Callout>
        )}

        {!loading && data && data.decisions?.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">
              Recomendação por tier — só sugere trocar com significância (IC 95%,
              sem regredir qualidade/tool-sucesso); abaixo da amostra diz “sem
              amostra” em vez de chutar. A evidência está na tabela abaixo.
            </p>
            <DecisionCards decisions={data.decisions} />
          </div>
        )}

        {loading ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            Carregando…
          </div>
        ) : rows.every((r) => !r.hasData) ? (
          <EmptyState
            icon={Gauge}
            title="Sem dados de modelo na janela."
            description="Rode tasks escolhendo modelos concretos para popular a comparação."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Modelo</th>
                  <th className="px-2 py-2 text-right font-medium">Msgs</th>
                  <th className="px-2 py-2 text-right font-medium">
                    Custo real
                  </th>
                  <th className="px-2 py-2 text-center font-medium">
                    Achados (val/desc/pend)
                  </th>
                  <th className="px-2 py-2 text-right font-medium">
                    Taxa valid.
                  </th>
                  <th className="px-2 py-2 text-right font-medium">
                    Tool-sucesso
                  </th>
                  <th className="px-2 py-2 text-right font-medium">
                    Latência p50/p95
                  </th>
                  <th className="px-2 py-2 pl-3 font-medium">Finish</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const rate = validationRate(
                    r.findingsValidated,
                    r.findingsDismissed,
                  );
                  const curated = r.findingsValidated + r.findingsDismissed;
                  // Só colore a taxa quando há curadoria suficiente (mesmo piso da
                  // decisão) — 1/1=100% não pode aparecer "verde forte" (achado #13).
                  const rateColored = rate != null && curated >= MIN_CURATED;
                  const toolRate = toolSuccessRate(r.toolCalls, r.toolErrors);
                  const toolColored =
                    toolRate != null && r.toolCalls >= MIN_TOOLCALLS;
                  return (
                    <tr
                      key={r.slug}
                      className={cn(
                        "border-b border-border/60 last:border-0",
                        !r.hasData && "opacity-45",
                      )}
                    >
                      <td className="py-2 pr-3">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{r.label}</span>
                          <span
                            className={cn(
                              "rounded px-1.5 py-0.5 text-[10px] font-medium",
                              JURIS_TONE[r.jurisdiction] ?? JURIS_TONE.Other,
                            )}
                          >
                            {r.jurisdiction}
                          </span>
                        </div>
                        <div className="font-mono text-[10px] text-muted-foreground">
                          {r.slug}
                        </div>
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">
                        {r.assistantMessages || "—"}
                      </td>
                      <td
                        className="px-2 py-2 text-right tabular-nums"
                        title={
                          r.billedRequests > 0
                            ? `${r.billedRequests} req. faturadas`
                            : "sem custo faturado real na janela (pré-09/09 ou não atribuído)"
                        }
                      >
                        {r.billedRequests > 0 ? usd(r.billedCost) : "—"}
                      </td>
                      <td className="px-2 py-2 text-center">
                        <span className="inline-flex items-center gap-1.5 tabular-nums">
                          <span
                            className="inline-flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400"
                            title="Validados (aprovados/publicados)"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            {r.findingsValidated}
                          </span>
                          <span
                            className="inline-flex items-center gap-0.5 text-destructive"
                            title="Descartados (dismissed)"
                          >
                            <XCircle className="h-3.5 w-3.5" />
                            {r.findingsDismissed}
                          </span>
                          <span
                            className="inline-flex items-center gap-0.5 text-muted-foreground"
                            title="Pendentes (rascunho/em revisão)"
                          >
                            <Clock className="h-3.5 w-3.5" />
                            {r.findingsPending}
                          </span>
                        </span>
                      </td>
                      <td
                        className={cn(
                          "px-2 py-2 text-right tabular-nums",
                          rateColored &&
                            (rate! >= 0.7
                              ? "text-emerald-600 dark:text-emerald-400"
                              : rate! < 0.4
                                ? "text-destructive"
                                : "text-amber-600 dark:text-amber-400"),
                          rate != null && !rateColored && "text-muted-foreground",
                        )}
                        title={
                          rate != null
                            ? `${r.findingsValidated}/${curated} curados${curated < MIN_CURATED ? ` · amostra baixa (mín ${MIN_CURATED})` : ""}`
                            : "sem achados curados na janela"
                        }
                      >
                        {rate != null ? `${Math.round(rate * 100)}%` : "—"}
                      </td>
                      <td
                        className={cn(
                          "px-2 py-2 text-right tabular-nums",
                          toolColored &&
                            (toolRate! >= 0.95
                              ? "text-emerald-600 dark:text-emerald-400"
                              : toolRate! < 0.8
                                ? "text-destructive"
                                : "text-amber-600 dark:text-amber-400"),
                          toolRate != null &&
                            !toolColored &&
                            "text-muted-foreground",
                        )}
                        title={
                          toolRate != null
                            ? `${r.toolCalls} tool-calls · ${r.toolErrors} erros${r.toolCalls < MIN_TOOLCALLS ? ` · amostra baixa (mín ${MIN_TOOLCALLS})` : ""}`
                            : "sem tool-calls na janela (só linhas pós-Fase B)"
                        }
                      >
                        {toolRate != null
                          ? `${Math.round(toolRate * 100)}%`
                          : "—"}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">
                        {ms(r.latencyP50Ms)}
                        <span className="mx-0.5 text-border">/</span>
                        {ms(r.latencyP95Ms)}
                      </td>
                      <td className="max-w-[180px] px-2 py-2 pl-3">
                        <div className="flex flex-wrap gap-1">
                          {r.finishReasons.slice(0, 3).map((f) => (
                            <span
                              key={f.reason}
                              className="rounded bg-muted/60 px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground"
                              title={f.reason}
                            >
                              {f.reason.length > 14
                                ? `${f.reason.slice(0, 14)}…`
                                : f.reason}{" "}
                              {f.count}
                            </span>
                          ))}
                          {r.finishReasons.length === 0 && (
                            <span className="text-xs text-muted-foreground">
                              —
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {data && (
          <p className="text-right text-[10px] text-muted-foreground">
            Atualizado {formatDateTime(data.generatedAt)} · achados = curadoria
            humana (não o veredito do agente)
          </p>
        )}
      </CardContent>
    </Card>
  );
}
