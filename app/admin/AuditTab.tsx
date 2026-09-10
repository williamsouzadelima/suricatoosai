"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Search, Download, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toCsv, downloadCsv, csvName } from "@/lib/utils/csv";

interface Entry {
  actor: string;
  action: string;
  target?: string;
  detail?: string;
  created_at: number;
}

const fmt = (ms: number) =>
  new Date(ms).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

// Cor por prefixo da ação.
function actionBadge(action: string): string {
  const p = action.split(".")[0];
  if (p === "usuario" || action.includes("revogar"))
    return "border-destructive/30 bg-destructive/10 text-destructive";
  if (p === "campanha" || p === "aviso")
    return "border-primary/30 bg-primary/10 text-primary";
  if (p === "convite" || action === "grandfather")
    return "border-success/30 bg-success/10 text-success";
  return "border-border bg-muted text-muted-foreground";
}

export function AuditTab() {
  const [items, setItems] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/audit", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setItems(data.items ?? []);
    } catch (error) {
      toast.error("Falha ao carregar auditoria.");
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (e) =>
        e.actor.toLowerCase().includes(q) ||
        e.action.toLowerCase().includes(q) ||
        (e.target ?? "").toLowerCase().includes(q) ||
        (e.detail ?? "").toLowerCase().includes(q),
    );
  }, [items, query]);

  const exportCsv = useCallback(() => {
    downloadCsv(
      csvName("auditoria"),
      toCsv(
        filtered.map((e) => ({
          quando: new Date(e.created_at).toISOString(),
          quem: e.actor,
          acao: e.action,
          alvo: e.target ?? "",
          detalhe: e.detail ?? "",
        })),
        [
          { key: "quando", label: "Quando" },
          { key: "quem", label: "Quem" },
          { key: "acao", label: "Ação" },
          { key: "alvo", label: "Alvo" },
          { key: "detalhe", label: "Detalhe" },
        ],
      ),
    );
  }, [filtered]);

  return (
    <div className="mt-6 rounded-xl border bg-card">
      <div className="flex flex-col gap-3 border-b p-5 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-base font-semibold">
          Auditoria
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            {items.length}
          </span>
        </h2>
        <div className="flex items-center gap-2">
          <div className="relative sm:w-72">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar quem/ação/alvo…"
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

      {loading ? (
        <div className="p-8 text-center text-sm text-muted-foreground">
          Carregando…
        </div>
      ) : filtered.length === 0 ? (
        <div className="p-10 text-center text-sm text-muted-foreground">
          {items.length === 0
            ? "Nenhuma ação registrada ainda."
            : "Nenhum resultado para a busca."}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-5 py-3 font-medium">Quando</th>
                <th className="px-5 py-3 font-medium">Quem</th>
                <th className="px-5 py-3 font-medium">Ação</th>
                <th className="px-5 py-3 font-medium">Alvo / detalhe</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e, i) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="whitespace-nowrap px-5 py-2.5 text-muted-foreground">
                    {fmt(e.created_at)}
                  </td>
                  <td className="px-5 py-2.5">{e.actor}</td>
                  <td className="px-5 py-2.5">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs font-medium ${actionBadge(
                        e.action,
                      )}`}
                    >
                      {e.action}
                    </span>
                  </td>
                  <td className="px-5 py-2.5 text-muted-foreground">
                    {e.target && <span className="font-medium">{e.target}</span>}
                    {e.target && e.detail ? " — " : ""}
                    {e.detail}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
