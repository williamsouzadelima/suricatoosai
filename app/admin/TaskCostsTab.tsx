"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Search,
  Download,
  RefreshCw,
  AlertTriangle,
  X,
  Loader2,
  DollarSign,
  Receipt,
  Server,
  Hash,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import {
  SectionHeader,
  StatusBadge,
  StatCard,
  Callout,
  EmptyState,
  formatDateTime,
  fmtNum,
  fmtDuration,
  type Tone,
} from "./_ui";
import { toCsv, downloadCsv, csvName } from "@/lib/utils/csv";

interface Task {
  chatId: string | null;
  title: string;
  userId: string;
  userEmail: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  modelCostDollars: number;
  nonModelCostDollars: number;
  costDollars: number;
  providerBilledCostDollars: number;
  hasRealCost: boolean;
  models: string[];
  costSource: string;
  lastActivityAt: number | null;
  firstActivityAt: number | null;
  capped: boolean;
}

interface RunRow {
  runId: string;
  model: string;
  endpoint: string | null;
  at: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costDollars: number;
  providerBilledCostDollars: number;
  hasRealCost: boolean;
}

interface ModelRow {
  model: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costDollars: number;
  providerBilledCostDollars: number;
  hasRealCost: boolean;
}

interface Detail {
  chatId: string;
  title: string;
  userId: string | null;
  userEmail: string | null;
  total: {
    requests: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    modelCostDollars: number;
    nonModelCostDollars: number;
    costDollars: number;
    providerBilledCostDollars: number;
    hasRealCost: boolean;
  };
  byModel: ModelRow[];
  byRun: RunRow[];
  firstActivityAt: number | null;
  lastActivityAt: number | null;
  capped: boolean;
}

// Sub-cent costs must not round to $0.00 — always show 4 decimals.
const money = (n: number) => `$${(n ?? 0).toFixed(4)}`;

const REAL_COST_HINT =
  "Sem custo real: execuções anteriores a 09/09/2026, quando o custo real do OpenRouter passou a ser capturado. Só o valor Registrado existe para esta linha.";

// Verde com o valor quando ha custo real; traco cinza com tooltip quando nao ha
// (linha anterior a 09/09/2026, sem provider_billed_cost_dollars).
function RealCost({ has, value }: { has: boolean; value: number }) {
  if (has) return <>{money(value)}</>;
  return (
    <span
      className="cursor-help font-normal text-muted-foreground"
      title={REAL_COST_HINT}
    >
      —
    </span>
  );
}

function sourceTone(source: string): Tone {
  if (source === "provider") return "success";
  if (source === "hybrid") return "warning";
  return "destructive";
}

export function TaskCostsTab() {
  const [items, setItems] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/task-costs", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setItems(data.items ?? []);
    } catch (error) {
      toast.error("Falha ao carregar custos por task.");
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openDetail = useCallback(async (chatId: string | null) => {
    if (!chatId) return;
    setDetailLoading(true);
    setDetail(null);
    try {
      const res = await fetch(
        `/api/admin/task-costs/${encodeURIComponent(chatId)}`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setDetail(data.detail ?? null);
    } catch (error) {
      toast.error("Falha ao carregar o detalhe da task.");
      console.error(error);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.userEmail.toLowerCase().includes(q) ||
        t.models.some((m) => m.toLowerCase().includes(q)) ||
        (t.chatId ?? "").toLowerCase().includes(q),
    );
  }, [items, query]);

  const totals = useMemo(() => {
    return filtered.reduce(
      (acc, t) => {
        acc.real += t.providerBilledCostDollars;
        acc.registered += t.costDollars;
        acc.infra += t.nonModelCostDollars;
        return acc;
      },
      { real: 0, registered: 0, infra: 0 },
    );
  }, [filtered]);

  const anyCapped = filtered.some((t) => t.capped);

  const exportCsv = useCallback(() => {
    downloadCsv(
      csvName("custos-por-task"),
      toCsv(
        filtered.map((t) => ({
          task: t.title,
          chat_id: t.chatId ?? "",
          usuario: t.userEmail,
          modelos: t.models.join(" | "),
          requisicoes: t.requests,
          input_tokens: t.inputTokens,
          output_tokens: t.outputTokens,
          cache_read_tokens: t.cacheReadTokens,
          custo_real_usd: t.hasRealCost
            ? t.providerBilledCostDollars.toFixed(6)
            : "",
          custo_registrado_usd: t.costDollars.toFixed(6),
          custo_infra_usd: t.nonModelCostDollars.toFixed(6),
          fonte: t.costSource,
          inicio_atividade: t.firstActivityAt
            ? new Date(t.firstActivityAt).toISOString()
            : "",
          ultima_atividade: t.lastActivityAt
            ? new Date(t.lastActivityAt).toISOString()
            : "",
          duracao_seg:
            t.requests > 1 &&
            t.firstActivityAt != null &&
            t.lastActivityAt != null
              ? Math.round((t.lastActivityAt - t.firstActivityAt) / 1000)
              : "",
          parcial: t.capped ? "sim" : "",
        })),
        [
          { key: "task", label: "Task" },
          { key: "chat_id", label: "Chat ID" },
          { key: "usuario", label: "Usuário" },
          { key: "modelos", label: "Modelos" },
          { key: "requisicoes", label: "Requisições" },
          { key: "input_tokens", label: "Input tokens" },
          { key: "output_tokens", label: "Output tokens" },
          { key: "cache_read_tokens", label: "Cache read tokens" },
          { key: "custo_real_usd", label: "Custo real (US$)" },
          { key: "custo_registrado_usd", label: "Custo registrado (US$)" },
          { key: "custo_infra_usd", label: "Custo infra (US$)" },
          { key: "fonte", label: "Fonte" },
          { key: "inicio_atividade", label: "Início atividade" },
          { key: "ultima_atividade", label: "Última atividade" },
          { key: "duracao_seg", label: "Duração (s)" },
          { key: "parcial", label: "Parcial (cap)" },
        ],
      ),
    );
  }, [filtered]);

  return (
    <Card className="gap-0 py-0">
      <div className="flex flex-col gap-3 border-b p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <SectionHeader title="Custos por task" count={items.length} />
          <p className="mt-1 text-xs text-muted-foreground">
            Custo <strong>real</strong> = créditos deduzidos do OpenRouter
            (linhas novas). <strong>Registrado</strong> = cost_dollars
            histórico, pode subcontar. Infra = sandbox/estimativa. O traço{" "}
            <strong>—</strong> = execução anterior a 09/09/2026 (sem custo real
            capturado).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative sm:w-72">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar task/usuário/modelo…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-8"
            />
          </div>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={exportCsv}
            disabled={filtered.length === 0}
            title="Exportar CSV"
          >
            <Download className="h-4 w-4" />
            CSV
          </Button>
        </div>
      </div>

      {/* Totais da seleção */}
      <div className="flex flex-wrap gap-4 border-b px-4 py-3 text-sm">
        <div>
          <span className="text-muted-foreground">Custo real: </span>
          <span className="font-semibold text-success">
            {money(totals.real)}
          </span>
        </div>
        <div>
          <span className="text-muted-foreground">Registrado: </span>
          <span className="font-semibold">{money(totals.registered)}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Infra: </span>
          <span className="font-semibold">{money(totals.infra)}</span>
        </div>
        {anyCapped && (
          <div className="flex items-center gap-1 text-warning">
            <AlertTriangle className="h-3.5 w-3.5" />
            <span className="text-xs">
              Alguns totais são parciais (limite de 3000 linhas/usuário).
            </span>
          </div>
        )}
      </div>

      {loading ? (
        <div className="p-8 text-center text-sm text-muted-foreground">
          Carregando…
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Search}
          title={
            items.length === 0
              ? "Nenhum uso registrado ainda."
              : "Nenhum resultado para a busca."
          }
        />
      ) : (
        <div className="min-w-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-medium">Task</th>
                <th className="px-4 py-3 font-medium">Usuário</th>
                <th className="px-4 py-3 font-medium">Modelos</th>
                <th className="px-4 py-3 text-right font-medium">
                  Tokens (in/out)
                </th>
                <th className="px-4 py-3 text-right font-medium">Custo real</th>
                <th className="px-4 py-3 text-right font-medium">Registrado</th>
                <th className="px-4 py-3 text-right font-medium">Infra</th>
                <th className="px-4 py-3 font-medium">Fonte</th>
                <th className="px-4 py-3 text-right font-medium">Duração</th>
                <th className="px-4 py-3 font-medium">Última ativ.</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <tr
                  key={`${t.userId}:${t.chatId ?? "none"}`}
                  onClick={() => void openDetail(t.chatId)}
                  className={`border-b last:border-0 ${
                    t.chatId ? "cursor-pointer hover:bg-muted/40" : "opacity-70"
                  }`}
                >
                  <td className="max-w-[15rem] px-4 py-2.5">
                    <div className="flex items-center gap-1.5">
                      {t.capped && (
                        <AlertTriangle
                          className="h-3.5 w-3.5 shrink-0 text-warning"
                          aria-label="Total parcial"
                        />
                      )}
                      <span className="truncate font-medium">{t.title}</span>
                    </div>
                  </td>
                  <td className="max-w-[14rem] truncate px-4 py-2.5 text-muted-foreground">
                    {t.userEmail}
                  </td>
                  <td className="max-w-[9rem] truncate px-4 py-2.5 text-xs text-muted-foreground">
                    {t.models.join(", ") || "—"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right text-muted-foreground">
                    {fmtNum(t.inputTokens)} / {fmtNum(t.outputTokens)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right font-semibold text-success">
                    <RealCost
                      has={t.hasRealCost}
                      value={t.providerBilledCostDollars}
                    />
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right">
                    {money(t.costDollars)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right text-muted-foreground">
                    {money(t.nonModelCostDollars)}
                  </td>
                  <td className="px-4 py-2.5">
                    <StatusBadge
                      tone={sourceTone(t.costSource)}
                      label={t.costSource}
                    />
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                    {t.requests > 1 &&
                    t.firstActivityAt != null &&
                    t.lastActivityAt != null ? (
                      <span
                        title={`Tempo entre o 1º e o último request cobrado${
                          t.capped ? " (parcial: total limitado)" : ""
                        }`}
                      >
                        {t.capped ? "≥ " : ""}
                        {fmtDuration(t.lastActivityAt - t.firstActivityAt)}
                      </span>
                    ) : (
                      <span
                        className="cursor-help"
                        title="Duração não medida: request único (a latência por request não é registrada)."
                      >
                        n/d
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">
                    {formatDateTime(t.lastActivityAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(detail || detailLoading) && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => {
            setDetail(null);
            setDetailLoading(false);
          }}
        >
          <div
            className="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-xl border bg-card p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {detailLoading || !detail ? (
              <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Carregando detalhe…
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-lg font-semibold">{detail.title}</h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {detail.userEmail ?? detail.userId ?? "—"} ·{" "}
                      {detail.chatId}
                    </p>
                    {detail.firstActivityAt != null &&
                      detail.lastActivityAt != null && (
                        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                          <Clock className="h-3.5 w-3.5 shrink-0" />
                          {detail.total.requests > 1 ? (
                            <>
                              <span
                                className="font-medium text-foreground"
                                title="Duração total da task: do 1º ao último request cobrado."
                              >
                                {fmtDuration(
                                  detail.lastActivityAt -
                                    detail.firstActivityAt,
                                )}
                              </span>
                              <span>
                                · {formatDateTime(detail.firstActivityAt)} →{" "}
                                {formatDateTime(detail.lastActivityAt)}
                              </span>
                            </>
                          ) : (
                            <span
                              className="cursor-help"
                              title="Duração não medida: request único (a latência por request não é registrada)."
                            >
                              Duração n/d ·{" "}
                              {formatDateTime(detail.lastActivityAt)}
                            </span>
                          )}
                        </p>
                      )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setDetail(null)}
                    className="rounded-md p-1 text-muted-foreground hover:bg-muted"
                    aria-label="Fechar"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <StatCard
                    label="Custo real"
                    icon={DollarSign}
                    tone="success"
                    value={
                      detail.total.hasRealCost ? (
                        money(detail.total.providerBilledCostDollars)
                      ) : (
                        <span className="cursor-help" title={REAL_COST_HINT}>
                          —
                        </span>
                      )
                    }
                  />
                  <StatCard
                    label="Registrado"
                    icon={Receipt}
                    value={money(detail.total.costDollars)}
                  />
                  <StatCard
                    label="Infra"
                    icon={Server}
                    value={money(detail.total.nonModelCostDollars)}
                  />
                  <StatCard
                    label="Requisições"
                    icon={Hash}
                    value={String(detail.total.requests)}
                  />
                </div>

                {detail.capped && (
                  <div className="mt-3">
                    <Callout tone="warning" icon={AlertTriangle}>
                      Detalhe parcial (limite de {2000} linhas).
                    </Callout>
                  </div>
                )}

                <h4 className="mt-5 mb-2 text-sm font-semibold">Por modelo</h4>
                <div className="min-w-0 overflow-x-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                        <th className="px-3 py-2 font-medium">Modelo</th>
                        <th className="px-3 py-2 text-right font-medium">
                          Req
                        </th>
                        <th className="px-3 py-2 text-right font-medium">
                          In/Out
                        </th>
                        <th className="px-3 py-2 text-right font-medium">
                          Real
                        </th>
                        <th className="px-3 py-2 text-right font-medium">
                          Registrado
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.byModel.map((m) => (
                        <tr key={m.model} className="border-b last:border-0">
                          <td className="px-3 py-2">{m.model}</td>
                          <td className="px-3 py-2 text-right text-muted-foreground">
                            {m.requests}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-right text-muted-foreground">
                            {fmtNum(m.inputTokens)} / {fmtNum(m.outputTokens)}
                          </td>
                          <td className="px-3 py-2 text-right font-medium text-success">
                            <RealCost
                              has={m.hasRealCost}
                              value={m.providerBilledCostDollars}
                            />
                          </td>
                          <td className="px-3 py-2 text-right">
                            {money(m.costDollars)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <h4 className="mt-5 mb-2 text-sm font-semibold">
                  Por run ({detail.byRun.length})
                </h4>
                <div className="min-w-0 overflow-x-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                        <th className="px-3 py-2 font-medium">Quando</th>
                        <th className="px-3 py-2 font-medium">Modelo</th>
                        <th className="px-3 py-2 text-right font-medium">
                          In/Out
                        </th>
                        <th className="px-3 py-2 text-right font-medium">
                          Real
                        </th>
                        <th className="px-3 py-2 text-right font-medium">
                          Registrado
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.byRun.map((r) => (
                        <tr key={r.runId} className="border-b last:border-0">
                          <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                            {formatDateTime(r.at)}
                          </td>
                          <td className="px-3 py-2 text-xs">{r.model}</td>
                          <td className="whitespace-nowrap px-3 py-2 text-right text-muted-foreground">
                            {fmtNum(r.inputTokens)} / {fmtNum(r.outputTokens)}
                          </td>
                          <td className="px-3 py-2 text-right font-medium text-success">
                            <RealCost
                              has={r.hasRealCost}
                              value={r.providerBilledCostDollars}
                            />
                          </td>
                          <td className="px-3 py-2 text-right">
                            {money(r.costDollars)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
