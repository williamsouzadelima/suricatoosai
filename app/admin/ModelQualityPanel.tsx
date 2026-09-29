"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Gauge, RefreshCw, CheckCircle2, XCircle, Clock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SectionHeader, Callout, EmptyState, formatDateTime } from "./_ui";

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
  realCost: number;
  requests: number;
  outputTokens: number;
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

const JURIS_TONE: Record<string, string> = {
  US: "bg-chart-1/15 text-chart-1",
  China: "bg-amber-500/15 text-amber-500",
  EU: "bg-chart-2/15 text-chart-2",
  Other: "bg-muted text-muted-foreground",
};

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
          title="Comparar modelos — qualidade real (eval-gate)"
          description="Medição por modelo SERVIDO: custo real, achados validados, latência. Read-only."
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
          <strong>Fase A (3 de 4 métricas, read-only).</strong> Atribuição pelo
          modelo <strong>servido</strong> (reflete fallback). Qualidade ={" "}
          <strong>achados validados</strong> (aprovados/publicados na curadoria),
          nunca o veredito auto-declarado. <strong>Tool-success</strong> (a 4ª) é
          a Fase B (precisa instrumentar o runner). Custo real só pós-09/09;
          achado capturado em fallback sub-atribui ao modelo primário.
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
                      <td className="px-2 py-2 text-right tabular-nums">
                        {r.requests > 0 ? usd(r.realCost) : "—"}
                      </td>
                      <td className="px-2 py-2 text-center">
                        <span className="inline-flex items-center gap-1.5 tabular-nums">
                          <span
                            className="inline-flex items-center gap-0.5 text-emerald-500"
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
                          rate != null &&
                            (rate >= 0.7
                              ? "text-emerald-500"
                              : rate < 0.4
                                ? "text-destructive"
                                : "text-amber-500"),
                        )}
                      >
                        {rate != null ? `${Math.round(rate * 100)}%` : "—"}
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
