"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Cpu, RefreshCw, Square, AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  SectionHeader,
  StatCard,
  EmptyState,
  Callout,
  fmtDuration,
  useConfirm,
} from "./_ui";

interface Run {
  userId: string;
  email: string;
  chatId: string;
  title: string;
  runId: string;
  updatedAt: number;
}

export function LiveRunsPanel() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [killing, setKilling] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const load = useCallback(async (manual = false) => {
    if (manual) setIsRefreshing(true);
    try {
      const res = await fetch("/api/admin/live-runs", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      setRuns(d.runs ?? []);
      setNow(Date.now());
      setError(false);
    } catch (e) {
      console.error(e);
      setError(true);
    } finally {
      setLoading(false);
      if (manual) setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 20_000);
    return () => clearInterval(id);
  }, [load]);

  const [confirm, confirmUI] = useConfirm();
  const kill = useCallback(
    async (r: Run) => {
      if (
        !(await confirm({
          title: "Abortar run",
          description: `Abortar o run em execução de "${r.title}" (${r.email})? A task será cancelada.`,
          confirmLabel: "Abortar",
          tone: "destructive",
        }))
      ) {
        return;
      }
      setKilling(r.chatId);
      try {
        const res = await fetch("/api/admin/live-runs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chatId: r.chatId }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        toast.success("Cancelamento enviado ao run.");
        await load();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Falha ao abortar.");
      } finally {
        setKilling(null);
      }
    },
    [load, confirm],
  );

  return (
    <Card className="gap-0 py-0">
      {confirmUI}
      <div className="flex flex-col gap-3 border-b p-5 sm:flex-row sm:items-center sm:justify-between">
        <SectionHeader
          icon={Cpu}
          title="Runs ao vivo"
          description="Agentes executando agora (usuários com presença recente). Atualiza a cada 20s."
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => void load(true)}
          disabled={loading || isRefreshing}
        >
          <RefreshCw
            className={
              loading || isRefreshing ? "h-4 w-4 animate-spin" : "h-4 w-4"
            }
          />
          Atualizar
        </Button>
      </div>
      <CardContent className="space-y-4 p-5">
        <div className="grid grid-cols-1 gap-3 sm:max-w-xs">
          <StatCard
            icon={Cpu}
            tone={!error && runs.length > 0 ? "primary" : "neutral"}
            label="Rodando agora"
            value={error ? "—" : loading ? 0 : runs.length}
            sub="runs de agente ativos"
            loading={loading}
          />
        </div>

        {error ? (
          <Callout tone="warning" icon={AlertTriangle}>
            Não consegui carregar os runs ao vivo —{" "}
            <strong>indisponível, não zerado</strong>. Toque em “Atualizar” para
            tentar de novo.
          </Callout>
        ) : !loading && runs.length === 0 ? (
          <EmptyState icon={Cpu} title="Nenhum run em execução." />
        ) : (
          <div className="overflow-hidden rounded-lg border">
            {runs.map((r) => (
              <div
                key={r.chatId}
                className="flex items-center justify-between gap-3 border-b px-4 py-2.5 text-sm last:border-0"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">{r.title}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {r.email} · {r.runId.slice(0, 14)} · há{" "}
                    {fmtDuration(now - r.updatedAt)}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="shrink-0 text-destructive hover:text-destructive"
                  disabled={killing === r.chatId}
                  onClick={() => void kill(r)}
                >
                  <Square className="h-3.5 w-3.5" />
                  Abortar
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
