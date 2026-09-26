"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  DollarSign,
  Coins,
  Zap,
  Cpu,
  Building2,
  Route,
  UserRound,
  TrendingUp,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  StatCard,
  SectionHeader,
  Callout,
  EmptyState,
  formatDateTime,
  fmtNum,
} from "./_ui";

const PERIODS: { key: Period; label: string }[] = [
  { key: "1h", label: "1h" },
  { key: "24h", label: "24h" },
  { key: "7d", label: "7d" },
  { key: "30d", label: "30d" },
  { key: "90d", label: "3m" },
  { key: "180d", label: "6m" },
  { key: "365d", label: "1a" },
];
type Period = "1h" | "24h" | "7d" | "30d" | "90d" | "180d" | "365d";

interface Series {
  t: number;
  realCost: number;
  registeredCost: number;
  requests: number;
}
interface ByClient {
  clientId: string | null;
  name: string;
  realCost: number;
  registeredCost: number;
  requests: number;
}
interface ByModel {
  model: string;
  realCost: number;
  registeredCost: number;
  requests: number;
  inputTokens: number;
  outputTokens: number;
}
interface ByEndpoint {
  endpoint: string;
  realCost: number;
  requests: number;
}
interface ByUser {
  userId: string;
  email: string;
  realCost: number;
  requests: number;
  lastActivityAt: number | null;
}
interface ClientOpt {
  id: string;
  name: string;
  status: "active" | "archived";
}
interface Analytics {
  period: Period;
  from: number;
  to: number;
  bucketMs: number;
  totals: {
    realCost: number;
    registeredCost: number;
    requests: number;
    inputTokens: number;
    outputTokens: number;
    realRows: number;
  };
  series: Series[];
  byClient: ByClient[];
  byModel: ByModel[];
  byEndpoint: ByEndpoint[];
  byUser: ByUser[];
  clients: ClientOpt[];
  capped: boolean;
  scannedRows: number;
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function fmtUSD(n: number): string {
  if (!Number.isFinite(n)) return "$0";
  return `$${n >= 1 ? n.toFixed(2) : n.toFixed(4)}`;
}

function cleanModel(m: string): string {
  return m
    .replace(/^model-/, "")
    .replace(/^fallback-/, "")
    .replace(/-model$/, "")
    .replace(/^[a-z-]+\//, "")
    .replace(/-\d{8}$/, "");
}

function cleanEndpoint(e: string): string {
  return e.replace(/^\/api\//, "");
}

function bucketLabel(t: number, bucketMs: number): string {
  const d = new Date(t);
  if (bucketMs <= HOUR)
    return d.toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  if (bucketMs >= 28 * DAY)
    return d.toLocaleDateString("pt-BR", { month: "short" });
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

/** Gráfico de tendência de custo (barras, sem lib) — segue o estilo do _ui. */
function TrendChart({
  series,
  bucketMs,
}: {
  series: Series[];
  bucketMs: number;
}) {
  const max = Math.max(0, ...series.map((s) => s.realCost));
  const total = series.reduce((a, s) => a + s.realCost, 0);
  if (total <= 0) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
        Sem custo no período selecionado.
      </div>
    );
  }
  const first = series[0];
  const last = series[series.length - 1];
  return (
    <div>
      <div className="flex h-40 items-stretch gap-[3px] border-b border-border pb-px">
        {series.map((s, i) => (
          <div key={i} className="group relative flex-1 rounded-sm bg-muted/30">
            <div
              className="absolute bottom-0 left-0 w-full rounded-sm bg-gradient-to-t from-primary to-chart-1"
              style={{
                height:
                  s.realCost > 0
                    ? `${Math.max(3, (s.realCost / max) * 100)}%`
                    : "0%",
              }}
            />
            <span className="pointer-events-none absolute -top-11 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-popover px-2 py-1 text-xs text-popover-foreground shadow group-hover:block">
              <span className="font-semibold tabular-nums">
                {fmtUSD(s.realCost)}
              </span>
              <span className="mx-1 text-muted-foreground">·</span>
              <span className="tabular-nums text-muted-foreground">
                {s.requests} reqs
              </span>
              <br />
              <span className="text-muted-foreground">
                {bucketLabel(s.t, bucketMs)}
              </span>
            </span>
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>{first && bucketLabel(first.t, bucketMs)}</span>
        <span className="tabular-nums">pico {fmtUSD(max)} / faixa</span>
        <span>{last && bucketLabel(last.t, bucketMs)}</span>
      </div>
    </div>
  );
}

/** Barra horizontal de ranking (nome + valor + trilho proporcional). */
function RankBar({
  label,
  value,
  max,
  sub,
  tone = "primary",
}: {
  label: string;
  value: string;
  max: number;
  sub?: string;
  tone?: "primary" | "brand";
}) {
  const raw = Number(value.replace(/[^0-9.]/g, "")) || 0;
  const pct = max > 0 ? Math.max(2, (raw / max) * 100) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="min-w-0 truncate font-medium">{label}</span>
        <span className="shrink-0 tabular-nums">{value}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full",
            tone === "brand" ? "bg-brand" : "bg-primary",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      {sub && (
        <div className="mt-0.5 text-xs tabular-nums text-muted-foreground">
          {sub}
        </div>
      )}
    </div>
  );
}

export function CostAnalyticsPanel() {
  const [period, setPeriod] = useState<Period>("30d");
  const [clientId, setClientId] = useState<string>("all");
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/admin/cost-analytics?period=${period}&clientId=${encodeURIComponent(
          clientId,
        )}`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (e) {
      toast.error("Falha ao carregar análise de custos.");
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [period, clientId]);

  useEffect(() => {
    void load();
  }, [load]);

  const clients = data?.clients ?? [];
  const clientMax = useMemo(
    () => Math.max(0, ...(data?.byClient ?? []).map((c) => c.realCost)),
    [data],
  );
  const modelMax = useMemo(
    () => Math.max(0, ...(data?.byModel ?? []).map((m) => m.realCost)),
    [data],
  );
  const userMax = useMemo(
    () => Math.max(0, ...(data?.byUser ?? []).map((u) => u.realCost)),
    [data],
  );

  const selectedClientName =
    clientId === "all"
      ? "Todos os clientes"
      : (clients.find((c) => c.id === clientId)?.name ?? "Cliente");

  return (
    <Card className="gap-0 py-0">
      {/* Controles */}
      <div className="flex flex-col gap-3 border-b p-5 lg:flex-row lg:items-center lg:justify-between">
        <SectionHeader
          icon={TrendingUp}
          title="Análise de custos"
          description="Custo real (OpenRouter) por período, com recorte por cliente."
        />
        <div className="flex flex-wrap items-center gap-2">
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
          <select
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            className="h-8 rounded-md border bg-background px-2 text-sm"
          >
            <option value="all">Todos os clientes</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.status === "archived" ? " (arquivado)" : ""}
              </option>
            ))}
          </select>
        </div>
      </div>

      <CardContent className="space-y-5 p-5">
        {/* KPIs */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            icon={DollarSign}
            tone="success"
            label="Custo real"
            value={loading ? 0 : fmtUSD(data?.totals.realCost ?? 0)}
            sub={
              data
                ? `${data.totals.realRows}/${data.totals.requests} reqs c/ custo real`
                : undefined
            }
            loading={loading}
          />
          <StatCard
            icon={Coins}
            tone="neutral"
            label="Custo registrado"
            value={loading ? 0 : fmtUSD(data?.totals.registeredCost ?? 0)}
            sub="cost_dollars (pode subcontar)"
            loading={loading}
          />
          <StatCard
            icon={Zap}
            tone="primary"
            label="Requests"
            value={loading ? 0 : fmtNum(data?.totals.requests ?? 0)}
            sub={selectedClientName}
            loading={loading}
          />
          <StatCard
            icon={Cpu}
            tone="brand"
            label="Tokens"
            value={
              loading
                ? 0
                : fmtNum(
                    (data?.totals.inputTokens ?? 0) +
                      (data?.totals.outputTokens ?? 0),
                  )
            }
            sub={
              data
                ? `${fmtNum(data.totals.inputTokens)} in · ${fmtNum(
                    data.totals.outputTokens,
                  )} out`
                : undefined
            }
            loading={loading}
          />
        </div>

        {data?.capped && (
          <Callout tone="warning">
            Teto de leitura atingido ({data.scannedRows.toLocaleString("pt-BR")}{" "}
            linhas). Os totais são um <strong>limite inferior</strong> sobre as
            requisições mais recentes da janela.
          </Callout>
        )}

        {/* Tendência */}
        <div className="rounded-xl border p-4">
          <div className="mb-3">
            <SectionHeader
              title="Tendência de custo real"
              description={
                loading || !data
                  ? undefined
                  : `${bucketLabel(data.from, DAY)} → ${bucketLabel(
                      data.to,
                      DAY,
                    )} · barras a cada ${
                      data.bucketMs <= HOUR
                        ? `${Math.round(data.bucketMs / 60000)} min`
                        : data.bucketMs >= 28 * DAY
                          ? "mês"
                          : data.bucketMs >= 7 * DAY
                            ? "semana"
                            : "dia"
                    }`
              }
            />
          </div>
          {loading || !data ? (
            <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
              Carregando…
            </div>
          ) : (
            <TrendChart series={data.series} bucketMs={data.bucketMs} />
          )}
        </div>

        {/* Quebras */}
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Por cliente */}
          <div className="rounded-xl border p-4">
            <div className="mb-3">
              <SectionHeader
                icon={Building2}
                title="Por cliente"
                count={data?.byClient.length}
              />
            </div>
            {loading ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                Carregando…
              </div>
            ) : (data?.byClient.length ?? 0) === 0 ? (
              <EmptyState icon={Building2} title="Sem custo no período." />
            ) : (
              <div className="space-y-3">
                {data!.byClient.map((c) => (
                  <RankBar
                    key={c.clientId ?? "unassigned"}
                    label={c.name}
                    value={fmtUSD(c.realCost)}
                    max={clientMax}
                    sub={`${c.requests} reqs`}
                    tone={c.clientId ? "primary" : "brand"}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Por modelo */}
          <div className="rounded-xl border p-4">
            <div className="mb-3">
              <SectionHeader
                icon={Cpu}
                title="Por modelo"
                count={data?.byModel.length}
              />
            </div>
            {loading ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                Carregando…
              </div>
            ) : (data?.byModel.length ?? 0) === 0 ? (
              <EmptyState icon={Cpu} title="Sem uso no período." />
            ) : (
              <div className="space-y-3">
                {data!.byModel.map((m) => (
                  <RankBar
                    key={m.model}
                    label={cleanModel(m.model)}
                    value={fmtUSD(m.realCost)}
                    max={modelMax}
                    sub={`${m.requests} reqs · ${fmtNum(
                      m.inputTokens + m.outputTokens,
                    )} tok`}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Por endpoint */}
          <div className="rounded-xl border p-4">
            <div className="mb-3">
              <SectionHeader
                icon={Route}
                title="Por endpoint"
                count={data?.byEndpoint.length}
              />
            </div>
            {loading ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                Carregando…
              </div>
            ) : (data?.byEndpoint.length ?? 0) === 0 ? (
              <EmptyState icon={Route} title="Sem uso no período." />
            ) : (
              <div className="space-y-2">
                {data!.byEndpoint.map((e) => (
                  <div
                    key={e.endpoint}
                    className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2 text-sm"
                  >
                    <span className="font-mono text-xs">
                      {cleanEndpoint(e.endpoint)}
                    </span>
                    <span className="tabular-nums">
                      {fmtUSD(e.realCost)}
                      <span className="ml-2 text-xs text-muted-foreground">
                        {e.requests} reqs
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Por usuário */}
          <div className="rounded-xl border p-4">
            <div className="mb-3">
              <SectionHeader
                icon={UserRound}
                title="Atividade por usuário"
                count={data?.byUser.length}
              />
            </div>
            {loading ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                Carregando…
              </div>
            ) : (data?.byUser.length ?? 0) === 0 ? (
              <EmptyState icon={UserRound} title="Sem atividade no período." />
            ) : (
              <div className="space-y-3">
                {data!.byUser.map((u) => (
                  <RankBar
                    key={u.userId}
                    label={u.email}
                    value={fmtUSD(u.realCost)}
                    max={userMax}
                    sub={`${u.requests} reqs · ${formatDateTime(
                      u.lastActivityAt,
                    )}`}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
