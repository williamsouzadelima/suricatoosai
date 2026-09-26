"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Banknote, Coins, PiggyBank, Percent, LineChart } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { StatCard, SectionHeader, Callout, fmtNum } from "./_ui";

const PERIODS: { key: Period; label: string }[] = [
  { key: "7d", label: "7d" },
  { key: "30d", label: "30d" },
  { key: "90d", label: "3m" },
  { key: "180d", label: "6m" },
  { key: "365d", label: "1a" },
];
type Period = "7d" | "30d" | "90d" | "180d" | "365d";

interface RevSeries {
  t: number;
  revenue: number;
  cost: number;
  profit: number;
}
interface Revenue {
  period: Period;
  fromDay: string;
  toDay: string;
  bucketDays: number;
  totals: {
    revenue: number;
    revenueUser: number;
    revenueOrg: number;
    cost: number;
    grossProfit: number;
    marginPct: number;
    mrr: number;
    requests: number;
    inputTokens: number;
    outputTokens: number;
  };
  series: RevSeries[];
  capped: boolean;
  dayRows: number;
}

function fmtUSD(n: number): string {
  if (!Number.isFinite(n)) return "$0";
  const abs = Math.abs(n);
  const s = `$${abs >= 1 ? abs.toFixed(2) : abs.toFixed(4)}`;
  return n < 0 ? `-${s}` : s;
}

function bucketLabel(t: number, bucketDays: number): string {
  const d = new Date(t);
  if (bucketDays >= 28)
    return d.toLocaleDateString("pt-BR", { month: "short" });
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

/** Barras agrupadas receita (verde) vs. custo (azul) por bucket. */
function RevCostChart({
  series,
  bucketDays,
}: {
  series: RevSeries[];
  bucketDays: number;
}) {
  const max = Math.max(0, ...series.map((s) => Math.max(s.revenue, s.cost)));
  if (max <= 0) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
        Sem receita nem custo no período.
      </div>
    );
  }
  const first = series[0];
  const last = series[series.length - 1];
  return (
    <div>
      <div className="mb-2 flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-success" /> Receita
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-primary" /> Custo
        </span>
      </div>
      <div className="flex h-40 items-stretch gap-[3px] border-b border-border pb-px">
        {series.map((s, i) => (
          <div key={i} className="group flex flex-1 items-stretch gap-0.5">
            <div className="relative flex-1 rounded-sm bg-muted/30">
              <div
                className="absolute bottom-0 left-0 w-full rounded-sm bg-success"
                style={{
                  height:
                    s.revenue > 0
                      ? `${Math.max(3, (s.revenue / max) * 100)}%`
                      : "0%",
                }}
              />
            </div>
            <div className="relative flex-1 rounded-sm bg-muted/30">
              <div
                className="absolute bottom-0 left-0 w-full rounded-sm bg-primary"
                style={{
                  height:
                    s.cost > 0 ? `${Math.max(3, (s.cost / max) * 100)}%` : "0%",
                }}
              />
              <span className="pointer-events-none absolute -top-14 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-popover px-2 py-1 text-xs text-popover-foreground shadow group-hover:block">
                <span className="text-success">R {fmtUSD(s.revenue)}</span>
                <br />
                <span className="text-popover-foreground">
                  C {fmtUSD(s.cost)}
                </span>
                <br />
                <span className="text-muted-foreground">
                  {bucketLabel(s.t, bucketDays)}
                </span>
              </span>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>{first && bucketLabel(first.t, bucketDays)}</span>
        <span className="tabular-nums">pico {fmtUSD(max)} / bucket</span>
        <span>{last && bucketLabel(last.t, bucketDays)}</span>
      </div>
    </div>
  );
}

export function RevenuePanel() {
  const [period, setPeriod] = useState<Period>("30d");
  const [data, setData] = useState<Revenue | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/revenue-analytics?period=${period}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (e) {
      toast.error("Falha ao carregar receita/lucro.");
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    void load();
  }, [load]);

  const t = data?.totals;
  const profitTone =
    t && t.grossProfit >= 0 ? ("success" as const) : ("destructive" as const);

  return (
    <Card className="gap-0 py-0">
      <div className="flex flex-col gap-3 border-b p-5 lg:flex-row lg:items-center lg:justify-between">
        <SectionHeader
          icon={LineChart}
          title="Receita e lucro"
          description="Visão de negócio (unit economics) — receita, custo e margem no período."
        />
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
      </div>

      <CardContent className="space-y-5 p-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            icon={Banknote}
            tone="success"
            label="Receita"
            value={loading ? 0 : fmtUSD(t?.revenue ?? 0)}
            sub={
              t
                ? `${fmtUSD(t.revenueUser)} indiv. · ${fmtUSD(t.revenueOrg)} times`
                : undefined
            }
            loading={loading}
          />
          <StatCard
            icon={Coins}
            tone="primary"
            label="Custo"
            value={loading ? 0 : fmtUSD(t?.cost ?? 0)}
            sub={
              t
                ? `${fmtNum(t.inputTokens + t.outputTokens)} tok · ${fmtNum(
                    t.requests,
                  )} reqs`
                : undefined
            }
            loading={loading}
          />
          <StatCard
            icon={PiggyBank}
            tone={profitTone}
            label="Lucro bruto"
            value={loading ? 0 : fmtUSD(t?.grossProfit ?? 0)}
            sub={t && t.mrr > 0 ? `MRR ${fmtUSD(t.mrr)}` : "receita − custo"}
            loading={loading}
          />
          <StatCard
            icon={Percent}
            tone={profitTone}
            label="Margem"
            value={
              loading
                ? 0
                : t && t.revenue > 0
                  ? `${t.marginPct.toFixed(1)}%`
                  : "—"
            }
            sub={
              t && t.revenue <= 0 ? "sem receita no período" : "sobre a receita"
            }
            loading={loading}
          />
        </div>

        {data?.capped && (
          <Callout tone="warning">
            Teto de leitura atingido ({data.dayRows.toLocaleString("pt-BR")}{" "}
            linhas diárias). Os totais são um <strong>limite inferior</strong>.
          </Callout>
        )}

        {t && t.revenue <= 0 && t.cost > 0 && (
          <Callout tone="info">
            Ainda não há receita registrada no período — o painel mostra o{" "}
            <strong>custo</strong> como despesa. Quando houver faturamento
            (assinaturas/uso extra), receita e margem passam a preencher aqui.
          </Callout>
        )}

        <div className="rounded-xl border p-4">
          <div className="mb-3">
            <SectionHeader
              title="Receita × custo"
              description={
                loading || !data
                  ? undefined
                  : `${bucketLabel(
                      Date.parse(`${data.fromDay}T00:00:00.000Z`),
                      1,
                    )} → ${bucketLabel(
                      Date.parse(`${data.toDay}T00:00:00.000Z`),
                      1,
                    )} · barras a cada ${
                      data.bucketDays === 1
                        ? "dia"
                        : data.bucketDays >= 28
                          ? "mês"
                          : `${data.bucketDays} dias`
                    }`
              }
            />
          </div>
          {loading || !data ? (
            <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
              Carregando…
            </div>
          ) : (
            <RevCostChart series={data.series} bucketDays={data.bucketDays} />
          )}
        </div>
      </CardContent>
    </Card>
  );
}
