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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  capped: boolean;
}

const fmtNum = (n: number) =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(2)}M`
    : n >= 1_000
      ? `${(n / 1_000).toFixed(1)}k`
      : String(n);

// Sub-cent costs must not round to $0.00 — always show 4 decimals.
const money = (n: number) => `$${(n ?? 0).toFixed(4)}`;

const fmtDate = (ms: number | null) =>
  ms
    ? new Date(ms).toLocaleString("pt-BR", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

function sourceBadge(source: string): string {
  if (source === "provider")
    return "border-success/30 bg-success/10 text-success";
  if (source === "hybrid")
    return "border-warning/30 bg-warning/10 text-warning";
  return "border-destructive/30 bg-destructive/10 text-destructive";
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
          ultima_atividade: t.lastActivityAt
            ? new Date(t.lastActivityAt).toISOString()
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
          { key: "ultima_atividade", label: "Última atividade" },
          { key: "parcial", label: "Parcial (cap)" },
        ],
      ),
    );
  }, [filtered]);

  return (
    <div className="mt-6 rounded-xl border bg-card">
      <div className="flex flex-col gap-3 border-b p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold">
            Custos por task
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {items.length}
            </span>
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Custo <strong>real</strong> = créditos deduzidos do OpenRouter
            (linhas novas). <strong>Registrado</strong> = cost_dollars histórico,
            pode subcontar. Infra = sandbox/estimativa.
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
      <div className="flex flex-wrap gap-4 border-b px-5 py-3 text-sm">
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
        <div className="p-10 text-center text-sm text-muted-foreground">
          {items.length === 0
            ? "Nenhum uso registrado ainda."
            : "Nenhum resultado para a busca."}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-5 py-3 font-medium">Task</th>
                <th className="px-5 py-3 font-medium">Usuário</th>
                <th className="px-5 py-3 font-medium">Modelos</th>
                <th className="px-5 py-3 text-right font-medium">Tokens (in/out)</th>
                <th className="px-5 py-3 text-right font-medium">Custo real</th>
                <th className="px-5 py-3 text-right font-medium">Registrado</th>
                <th className="px-5 py-3 text-right font-medium">Infra</th>
                <th className="px-5 py-3 font-medium">Fonte</th>
                <th className="px-5 py-3 font-medium">Última ativ.</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <tr
                  key={`${t.userId}:${t.chatId ?? "none"}`}
                  onClick={() => void openDetail(t.chatId)}
                  className={`border-b last:border-0 ${
                    t.chatId
                      ? "cursor-pointer hover:bg-muted/40"
                      : "opacity-70"
                  }`}
                >
                  <td className="max-w-[22rem] px-5 py-2.5">
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
                  <td className="max-w-[14rem] truncate px-5 py-2.5 text-muted-foreground">
                    {t.userEmail}
                  </td>
                  <td className="max-w-[12rem] truncate px-5 py-2.5 text-xs text-muted-foreground">
                    {t.models.join(", ") || "—"}
                  </td>
                  <td className="whitespace-nowrap px-5 py-2.5 text-right text-muted-foreground">
                    {fmtNum(t.inputTokens)} / {fmtNum(t.outputTokens)}
                  </td>
                  <td className="whitespace-nowrap px-5 py-2.5 text-right font-semibold text-success">
                    {t.hasRealCost ? money(t.providerBilledCostDollars) : "—"}
                  </td>
                  <td className="whitespace-nowrap px-5 py-2.5 text-right">
                    {money(t.costDollars)}
                  </td>
                  <td className="whitespace-nowrap px-5 py-2.5 text-right text-muted-foreground">
                    {money(t.nonModelCostDollars)}
                  </td>
                  <td className="px-5 py-2.5">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs font-medium ${sourceBadge(
                        t.costSource,
                      )}`}
                    >
                      {t.costSource}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-5 py-2.5 text-muted-foreground">
                    {fmtDate(t.lastActivityAt)}
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
                      {detail.userEmail ?? detail.userId ?? "—"} · {detail.chatId}
                    </p>
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
                  <Stat
                    label="Custo real"
                    value={
                      detail.total.hasRealCost
                        ? money(detail.total.providerBilledCostDollars)
                        : "—"
                    }
                    accent
                  />
                  <Stat
                    label="Registrado"
                    value={money(detail.total.costDollars)}
                  />
                  <Stat label="Infra" value={money(detail.total.nonModelCostDollars)} />
                  <Stat label="Requisições" value={String(detail.total.requests)} />
                </div>

                {detail.capped && (
                  <p className="mt-3 flex items-center gap-1 text-xs text-warning">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Detalhe parcial (limite de {2000} linhas).
                  </p>
                )}

                <h4 className="mt-5 mb-2 text-sm font-semibold">Por modelo</h4>
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="px-3 py-2 font-medium">Modelo</th>
                        <th className="px-3 py-2 text-right font-medium">Req</th>
                        <th className="px-3 py-2 text-right font-medium">In/Out</th>
                        <th className="px-3 py-2 text-right font-medium">Real</th>
                        <th className="px-3 py-2 text-right font-medium">Registrado</th>
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
                            {m.hasRealCost
                              ? money(m.providerBilledCostDollars)
                              : "—"}
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
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="px-3 py-2 font-medium">Quando</th>
                        <th className="px-3 py-2 font-medium">Modelo</th>
                        <th className="px-3 py-2 text-right font-medium">In/Out</th>
                        <th className="px-3 py-2 text-right font-medium">Real</th>
                        <th className="px-3 py-2 text-right font-medium">Registrado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.byRun.map((r) => (
                        <tr key={r.runId} className="border-b last:border-0">
                          <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                            {fmtDate(r.at)}
                          </td>
                          <td className="px-3 py-2 text-xs">{r.model}</td>
                          <td className="whitespace-nowrap px-3 py-2 text-right text-muted-foreground">
                            {fmtNum(r.inputTokens)} / {fmtNum(r.outputTokens)}
                          </td>
                          <td className="px-3 py-2 text-right font-medium text-success">
                            {r.hasRealCost
                              ? money(r.providerBilledCostDollars)
                              : "—"}
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
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={`mt-0.5 text-base font-semibold ${
          accent ? "text-success" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}
