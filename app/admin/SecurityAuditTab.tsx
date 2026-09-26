"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ShieldCheck, Download } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  SectionHeader,
  StatusBadge,
  EmptyState,
  formatDateTime,
  type Tone,
} from "./_ui";
import { toCsv, downloadCsv, csvName } from "@/lib/utils/csv";

interface AuditRow {
  id: string;
  eventType: string;
  actorEmail: string | null;
  actorKind: string;
  clientName: string | null;
  targetType: string | null;
  targetId: string | null;
  outcome: string;
  detail: string | null;
  ip: string | null;
  createdAt: number;
}

const EVENTS: { value: string; label: string; tone: Tone }[] = [
  { value: "report.generated", label: "Relatório gerado", tone: "info" },
  { value: "report.viewed", label: "Relatório visto", tone: "neutral" },
  { value: "report.downloaded", label: "Relatório baixado", tone: "primary" },
  { value: "evidence.viewed", label: "Evidência vista", tone: "neutral" },
  {
    value: "evidence.downloaded",
    label: "Evidência baixada",
    tone: "primary",
  },
  { value: "artifact.url_issued", label: "URL emitida", tone: "warning" },
  { value: "membership.granted", label: "Acesso concedido", tone: "success" },
  { value: "membership.revoked", label: "Acesso revogado", tone: "warning" },
  { value: "engagement.created", label: "Engajamento criado", tone: "neutral" },
  { value: "access.denied", label: "Acesso negado", tone: "destructive" },
  { value: "portal.enabled", label: "Portal habilitado", tone: "success" },
  { value: "portal.disabled", label: "Portal desabilitado", tone: "warning" },
  { value: "threat.detected", label: "Ameaça detectada", tone: "destructive" },
  {
    value: "enumeration.detected",
    label: "Enumeração detectada",
    tone: "destructive",
  },
  { value: "anomaly.detected", label: "Anomalia detectada", tone: "warning" },
  { value: "ip.blocked", label: "IP bloqueado", tone: "destructive" },
  { value: "ip.unblocked", label: "IP desbloqueado", tone: "success" },
  { value: "ioc.added", label: "IoC adicionado", tone: "warning" },
  { value: "ioc.removed", label: "IoC removido", tone: "neutral" },
  {
    value: "user.autoblocked",
    label: "Usuário auto-bloqueado",
    tone: "destructive",
  },
];
const EVENT_MAP = new Map(EVENTS.map((e) => [e.value, e]));

function outcomeTone(o: string): Tone {
  if (o === "success") return "success";
  if (o === "denied") return "warning";
  return "destructive";
}

export function SecurityAuditTab() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = filter === "all" ? "" : `?eventType=${filter}`;
      const res = await fetch(`/api/admin/security-audit${qs}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRows(data.rows ?? []);
    } catch (e) {
      toast.error("Falha ao carregar a auditoria de segurança.");
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const exportCsv = useCallback(() => {
    downloadCsv(
      csvName("auditoria-seguranca"),
      toCsv(
        rows.map((r) => ({
          quando: new Date(r.createdAt).toISOString(),
          evento: EVENT_MAP.get(r.eventType)?.label ?? r.eventType,
          resultado: r.outcome,
          ator: r.actorEmail ?? "",
          tipo_ator: r.actorKind,
          cliente: r.clientName ?? "",
          alvo: [r.targetType, r.targetId].filter(Boolean).join(" "),
          ip: r.ip ?? "",
          detalhe: r.detail ?? "",
        })),
        [
          { key: "quando", label: "Quando" },
          { key: "evento", label: "Evento" },
          { key: "resultado", label: "Resultado" },
          { key: "ator", label: "Ator" },
          { key: "tipo_ator", label: "Tipo ator" },
          { key: "cliente", label: "Cliente" },
          { key: "alvo", label: "Alvo" },
          { key: "ip", label: "IP" },
          { key: "detalhe", label: "Detalhe" },
        ],
      ),
    );
  }, [rows]);

  return (
    <Card className="gap-0 py-0">
      <div className="flex flex-col gap-3 border-b p-5 sm:flex-row sm:items-center sm:justify-between">
        <SectionHeader
          icon={ShieldCheck}
          title="Auditoria de segurança"
          description="Trilha imutável: quem gerou, viu e baixou relatórios/evidência + acessos negados."
          count={rows.length}
        />
        <div className="flex items-center gap-2">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="h-8 rounded-md border bg-background px-2 text-sm"
          >
            <option value="all">Todos os eventos</option>
            {EVENTS.map((e) => (
              <option key={e.value} value={e.value}>
                {e.label}
              </option>
            ))}
          </select>
          <Button
            variant="outline"
            size="sm"
            onClick={exportCsv}
            disabled={rows.length === 0}
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
      ) : rows.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title="Sem eventos de segurança."
          description="Gerar/baixar relatórios e conceder acessos registram aqui."
        />
      ) : (
        <div className="min-w-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="px-5 py-2.5 font-semibold">Quando</th>
                <th className="px-5 py-2.5 font-semibold">Evento</th>
                <th className="px-5 py-2.5 font-semibold">Ator</th>
                <th className="px-5 py-2.5 font-semibold">Cliente / alvo</th>
                <th className="px-5 py-2.5 font-semibold">Resultado</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const ev = EVENT_MAP.get(r.eventType);
                return (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="whitespace-nowrap px-5 py-2.5 tabular-nums text-muted-foreground">
                      {formatDateTime(r.createdAt)}
                    </td>
                    <td className="px-5 py-2.5">
                      <StatusBadge
                        tone={ev?.tone ?? "neutral"}
                        label={ev?.label ?? r.eventType}
                        dot={false}
                      />
                      {r.detail && (
                        <div className="mt-1 max-w-md truncate text-xs text-muted-foreground">
                          {r.detail}
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-2.5">
                      <div className="font-medium">{r.actorEmail ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">
                        {r.actorKind}
                        {r.ip ? ` · ${r.ip}` : ""}
                      </div>
                    </td>
                    <td className="px-5 py-2.5">
                      <div className="font-medium">{r.clientName ?? "—"}</div>
                      {(r.targetType || r.targetId) && (
                        <div className="truncate text-xs text-muted-foreground">
                          {r.targetType}
                          {r.targetId ? ` ${r.targetId.slice(0, 10)}` : ""}
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-2.5">
                      <StatusBadge
                        tone={outcomeTone(r.outcome)}
                        label={r.outcome}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
