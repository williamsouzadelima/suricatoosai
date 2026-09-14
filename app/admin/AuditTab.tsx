"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Search, Download, RefreshCw, ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { toCsv, downloadCsv, csvName } from "@/lib/utils/csv";
import {
  SectionHeader,
  StatusBadge,
  EmptyState,
  formatDateTime,
  type Tone,
} from "./_ui";

interface Entry {
  actor: string;
  action: string;
  target?: string;
  detail?: string;
  created_at: number;
}

// Tom do badge por prefixo da ação.
function actionTone(action: string): Tone {
  const p = action.split(".")[0];
  if (p === "usuario" || action.includes("revogar")) return "destructive";
  if (p === "campanha" || p === "aviso") return "primary";
  if (p === "convite" || action === "grandfather") return "success";
  return "neutral";
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
    <Card className="gap-0 py-0">
      <div className="border-b border-border p-5">
        <SectionHeader
          icon={ScrollText}
          title="Auditoria"
          count={items.length}
          action={
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
          }
        />
      </div>

      {loading ? (
        <div className="p-8 text-center text-sm text-muted-foreground">
          Carregando…
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={items.length === 0 ? ScrollText : Search}
          title={
            items.length === 0
              ? "Nenhuma ação registrada ainda."
              : "Nenhum resultado para a busca."
          }
        />
      ) : (
        <div className="min-w-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-5 py-3 font-medium">Quando</th>
                <th className="px-5 py-3 font-medium">Quem</th>
                <th className="px-5 py-3 font-medium">Ação</th>
                <th className="px-5 py-3 font-medium">Alvo / detalhe</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e, i) => (
                <tr key={i} className="border-b border-border last:border-0">
                  <td className="whitespace-nowrap px-5 py-2.5 tabular-nums text-muted-foreground">
                    {formatDateTime(e.created_at)}
                  </td>
                  <td className="px-5 py-2.5">{e.actor}</td>
                  <td className="px-5 py-2.5">
                    <StatusBadge
                      tone={actionTone(e.action)}
                      label={e.action}
                      dot={false}
                    />
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
    </Card>
  );
}
