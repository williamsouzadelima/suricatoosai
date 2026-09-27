"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Activity,
  CheckCircle2,
  Clock,
  Loader2,
  AlertTriangle,
  RefreshCw,
  FileText,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  SectionHeader,
  StatCard,
  Callout,
  formatDateTime,
  fmtDuration,
} from "./_ui";

interface ReportItem {
  id: string;
  audience: string;
  format: string;
  version: number;
  engagementName: string;
  clientName: string;
  createdAt?: number;
  updatedAt: number;
  hasRun?: boolean;
  error?: string;
}
interface Health {
  reports: {
    ready: number;
    readyCapped: boolean;
    queued: number;
    rendering: number;
    failed: number;
    stuck: number;
  };
  stuckList: ReportItem[];
  recentFailed: ReportItem[];
}

const AUDIENCE_LABEL: Record<string, string> = {
  technical: "Técnico",
  executive: "Executivo",
  commercial: "Comercial",
};

function label(r: ReportItem): string {
  return `${AUDIENCE_LABEL[r.audience] ?? r.audience} · ${r.format.toUpperCase()} v${r.version}`;
}

export function SystemHealthPanel() {
  const [data, setData] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/system-health", {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (e) {
      toast.error("Falha ao carregar saúde do sistema.");
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const r = data?.reports;
  const now = Date.now();
  const allHealthy =
    r && r.stuck === 0 && r.queued === 0 && r.rendering === 0 && r.failed === 0;

  return (
    <Card className="gap-0 py-0">
      <div className="flex flex-col gap-3 border-b p-5 sm:flex-row sm:items-center sm:justify-between">
        <SectionHeader
          icon={Activity}
          title="Saúde do sistema"
          description="Geração de relatórios — fila, execução e presos (worker do trigger)."
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => void load()}
          disabled={loading}
        >
          <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          Atualizar
        </Button>
      </div>

      <CardContent className="space-y-5 p-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <StatCard
            icon={CheckCircle2}
            tone="success"
            label="Prontos"
            value={loading ? 0 : `${r?.ready ?? 0}${r?.readyCapped ? "+" : ""}`}
            loading={loading}
          />
          <StatCard
            icon={Clock}
            tone={r && r.queued > 0 ? "warning" : "neutral"}
            label="Na fila"
            value={loading ? 0 : (r?.queued ?? 0)}
            loading={loading}
          />
          <StatCard
            icon={Loader2}
            tone={r && r.rendering > 0 ? "primary" : "neutral"}
            label="Gerando"
            value={loading ? 0 : (r?.rendering ?? 0)}
            loading={loading}
          />
          <StatCard
            icon={AlertTriangle}
            tone={r && r.stuck > 0 ? "destructive" : "neutral"}
            label="Presos"
            value={loading ? 0 : (r?.stuck ?? 0)}
            sub="fila/gerando > 10 min"
            loading={loading}
          />
          <StatCard
            icon={FileText}
            tone={r && r.failed > 0 ? "destructive" : "neutral"}
            label="Falhos"
            value={loading ? 0 : (r?.failed ?? 0)}
            loading={loading}
          />
        </div>

        {!loading && allHealthy && (
          <Callout tone="success" icon={CheckCircle2}>
            Nenhum relatório preso ou com falha, e nada na fila. Pipeline de
            geração saudável.
          </Callout>
        )}

        {!loading && r && r.stuck > 0 && (
          <div className="space-y-2">
            <Callout tone="destructive" icon={AlertTriangle}>
              {r.stuck} relatório(s) preso(s) há mais de 10 min. Sinal provável
              de worker do trigger mudo — reprocessar e/ou reiniciar
              suricatoos-trigger.
            </Callout>
            <div className="overflow-hidden rounded-lg border">
              {data!.stuckList.map((it) => (
                <div
                  key={it.id}
                  className="flex items-center justify-between gap-3 border-b px-4 py-2.5 text-sm last:border-0"
                >
                  <div className="min-w-0">
                    <div className="font-medium">{label(it)}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {it.clientName} · {it.engagementName}
                    </div>
                  </div>
                  <div className="shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                    <div>há {fmtDuration(now - it.updatedAt)}</div>
                    <div>{it.hasRun ? "com run" : "sem run"}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {!loading && data && data.recentFailed.length > 0 && (
          <div className="space-y-2">
            <SectionHeader
              icon={FileText}
              title="Falhas recentes"
              count={data.recentFailed.length}
            />
            <div className="overflow-hidden rounded-lg border">
              {data.recentFailed.map((it) => (
                <div
                  key={it.id}
                  className="border-b px-4 py-2.5 text-sm last:border-0"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium">{label(it)}</span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {formatDateTime(it.updatedAt)}
                    </span>
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {it.clientName} · {it.engagementName}
                  </div>
                  {it.error && (
                    <div className="mt-1 rounded bg-destructive/5 px-2 py-1 font-mono text-xs text-destructive">
                      {it.error}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
