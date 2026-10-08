"use client";

import { useEffect, useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import {
  FileText,
  FileCheck,
  Clock,
  Download,
  Eye,
  EyeOff,
  Loader2,
  RefreshCw,
  Trash2,
  Plus,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AppShell } from "@/components/internal/app-shell";
import {
  SectionHeader,
  StatCard,
  StatusBadge,
  EmptyState,
  Callout,
  formatDateTime,
} from "@/app/admin/_ui";
import {
  AUDIENCE_LABEL,
  AUDIENCE_DESC,
  REPORT_STATUS_TONE,
  REPORT_STATUS_LABEL,
  ALL_FORMATS,
  GENERATABLE_AUDIENCES,
  type ReportAudience,
  type ReportFormat,
  type ReportStatus,
  type ReportRow,
} from "@/components/internal/reports";

/**
 * Seção Relatórios: dossiê do engajamento (geração por audiência × formato,
 * versionado) promovido a rota própria. Escopada por engajamento; deep-link
 * ?e=<eng>. Reusa as queries/ações de reports de /engagements.
 */
export function RelatoriosPanel({
  userEmail,
  userRole,
  initialEngagementId,
}: {
  userEmail?: string;
  userRole?: string;
  initialEngagementId?: string;
}) {
  const clients = useQuery(api.clients.listClients);
  const engagements = useQuery(api.engagements.listEngagements, {});

  const [selectedEngagementId, setSelectedEngagementId] =
    useState<Id<"engagements"> | null>(
      initialEngagementId ? (initialEngagementId as Id<"engagements">) : null,
    );

  const effectiveEngagementId: Id<"engagements"> | null =
    selectedEngagementId ??
    (engagements && engagements.length > 0 ? engagements[0]._id : null);

  const clientNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of clients ?? []) m.set(c._id, c.name);
    return m;
  }, [clients]);

  const selectedEngagement = useMemo(
    () =>
      (engagements ?? []).find((e) => e._id === effectiveEngagementId) ?? null,
    [engagements, effectiveEngagementId],
  );

  // URL compartilhável sem recarregar (replaceState não é setState → ok aqui).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const p = new URLSearchParams();
    if (effectiveEngagementId) p.set("e", effectiveEngagementId);
    const qs = p.toString();
    window.history.replaceState(
      null,
      "",
      qs ? `/relatorios?${qs}` : "/relatorios",
    );
  }, [effectiveEngagementId]);

  const crumbs = ["Relatórios", selectedEngagement?.name].filter(
    Boolean,
  ) as string[];

  return (
    <AppShell
      active="relatorios"
      title="Relatórios"
      description="Dossiê gerado a partir dos achados aprovados. Público × formato, versionado a cada geração; baixe ou pré-visualize."
      icon={FileText}
      breadcrumb={crumbs}
      userEmail={userEmail}
      userRole={userRole}
    >
      <div className="flex flex-col gap-5">
        {/* Seletor de engajamento */}
        <Card className="gap-0 py-0">
          <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <SectionHeader
              title="Engajamento"
              description="Escolha o engajamento para ver e gerar relatórios."
            />
            <select
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={effectiveEngagementId ?? ""}
              onChange={(e) =>
                setSelectedEngagementId(
                  (e.target.value || null) as Id<"engagements"> | null,
                )
              }
            >
              <option value="">Selecionar…</option>
              {(engagements ?? []).map((e) => {
                const client = clientNameById.get(e.client_id);
                return (
                  <option key={e._id} value={e._id}>
                    {e.name}
                    {client ? ` · ${client}` : ""}
                  </option>
                );
              })}
            </select>
          </div>
        </Card>

        {engagements === undefined ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            Carregando…
          </div>
        ) : !effectiveEngagementId ? (
          <EmptyState
            icon={FileText}
            title="Nenhum engajamento ainda."
            description="Crie um cliente e um engajamento na seção Engajamentos para gerar relatórios."
          />
        ) : (
          <RelatoriosForEngagement engagementId={effectiveEngagementId} />
        )}
      </div>
    </AppShell>
  );
}

type ReportGroup = {
  id: string;
  audience: string;
  version: number;
  created_at: number;
  title?: string;
  rows: ReportRow[];
};

function RelatoriosForEngagement({
  engagementId,
}: {
  engagementId: Id<"engagements">;
}) {
  const reports = useQuery(api.reports.listReportsForEngagement, {
    engagementId,
  });
  // Janela de 30 dias ancorada no mount (estável → não re-subscreve a cada render).
  const [sinceMs] = useState(() => Date.now() - 30 * 24 * 60 * 60 * 1000);
  const downloads30d = useQuery(api.reports.countReportDownloadsForEngagement, {
    engagementId,
    sinceMs,
  });
  const deleteReportGroup = useAction(
    api.reportActions.deleteReportGroupWithFiles,
  );
  const setGroupVisibility = useMutation(
    api.reports.setReportGroupClientVisibility,
  );

  const [formats, setFormats] = useState<Set<ReportFormat>>(
    () => new Set<ReportFormat>(["pdf"]),
  );
  const [generatingAudience, setGeneratingAudience] =
    useState<ReportAudience | null>(null);
  const [reprocessing, setReprocessing] = useState<string | null>(null);
  const [deletingGroup, setDeletingGroup] = useState<string | null>(null);
  const [togglingVisibility, setTogglingVisibility] = useState<string | null>(
    null,
  );

  // Relógio para o "há X min" (re-render a cada 20s).
  const [nowTs, setNowTs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowTs(Date.now()), 20_000);
    return () => clearInterval(id);
  }, []);
  const minsAgo = (ms: number) => Math.max(0, Math.floor((nowTs - ms) / 60000));

  const toggleFormat = (f: ReportFormat) => {
    setFormats((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });
  };

  const generate = async (audience: ReportAudience) => {
    if (formats.size === 0) {
      toast.error("Selecione ao menos um formato.");
      return;
    }
    setGeneratingAudience(audience);
    try {
      const res = await fetch("/api/reports/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ engagementId, audience, formats: [...formats] }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || "Falha ao iniciar geração.");
      }
      const j = (await res.json()) as { version?: number };
      toast.success(
        `Geração iniciada (${AUDIENCE_LABEL[audience]}${
          j.version ? ` v${j.version}` : ""
        }). O status atualiza abaixo.`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao iniciar geração.");
      console.error(e);
    } finally {
      setGeneratingAudience(null);
    }
  };

  // Download por rota-proxy autenticada (sessão WorkOS via cookie); a rota grava
  // auditoria antes de servir e faz stream do S3.
  const download = (reportId: Id<"reports">) => {
    window.open(
      `/api/reports/${reportId}/download`,
      "_blank",
      "noopener,noreferrer",
    );
  };

  // Prévia inline: PDF direto; docx/pptx convertidos p/ PDF no host (cacheado).
  const openPreview = (reportId: Id<"reports">) => {
    window.open(
      `/api/reports/${reportId}/view`,
      "_blank",
      "noopener,noreferrer",
    );
  };

  const reprocess = async (reportGroupId: string) => {
    setReprocessing(reportGroupId);
    try {
      const res = await fetch("/api/reports/reprocess", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportGroupId }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || "Falha ao reprocessar.");
      }
      toast.success("Reprocessando… o status atualiza abaixo.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao reprocessar.");
      console.error(e);
    } finally {
      setReprocessing(null);
    }
  };

  const removeGroup = async (
    groupId: string,
    audienceLabel: string,
    version: number,
  ) => {
    if (
      !window.confirm(
        `Remover o relatório ${audienceLabel} v${version} (todos os formatos)? Esta ação não pode ser desfeita.`,
      )
    ) {
      return;
    }
    setDeletingGroup(groupId);
    try {
      await deleteReportGroup({ reportGroupId: groupId });
      toast.success("Relatório removido.");
    } catch (e) {
      toast.error("Falha ao remover o relatório.");
      console.error(e);
    } finally {
      setDeletingGroup(null);
    }
  };

  // Liga/desliga a visibilidade do relatório no portal do cliente. A lista
  // (useQuery reativa) se atualiza sozinha após a mutation.
  const toggleVisibility = async (groupId: string, visible: boolean) => {
    setTogglingVisibility(groupId);
    try {
      await setGroupVisibility({ reportGroupId: groupId, visible });
      toast.success(
        visible
          ? "Relatório visível ao cliente no portal."
          : "Relatório oculto do cliente.",
      );
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Falha ao alterar a visibilidade.",
      );
      console.error(e);
    } finally {
      setTogglingVisibility(null);
    }
  };

  // Agrupa as linhas (uma por formato) por report_group_id, recentes no topo.
  const groups = useMemo<ReportGroup[]>(() => {
    const map = new Map<string, ReportGroup>();
    for (const r of (reports ?? []) as ReportRow[]) {
      const g = map.get(r.report_group_id);
      if (g) {
        g.rows.push(r);
        g.created_at = Math.min(g.created_at, r.created_at);
      } else {
        map.set(r.report_group_id, {
          id: r.report_group_id,
          audience: r.audience,
          version: r.version,
          created_at: r.created_at,
          title: r.title,
          rows: [r],
        });
      }
    }
    return [...map.values()].sort((a, b) => b.created_at - a.created_at);
  }, [reports]);

  const kpis = useMemo(() => {
    let ready = 0;
    let pending = 0;
    for (const g of groups) {
      if (g.rows.every((r) => r.status === "ready")) ready += 1;
      if (g.rows.some((r) => r.status === "queued" || r.status === "rendering"))
        pending += 1;
    }
    return {
      groups: groups.length,
      ready,
      pending,
      files: reports?.length ?? 0,
    };
  }, [groups, reports]);

  return (
    <>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard
          label="Relatórios"
          value={String(kpis.groups)}
          icon={FileText}
          tone="primary"
          sub="dossiês gerados"
        />
        <StatCard
          label="Prontos"
          value={String(kpis.ready)}
          icon={FileCheck}
          tone="success"
          sub="publicáveis agora"
        />
        <StatCard
          label="Gerando"
          value={String(kpis.pending)}
          icon={Clock}
          tone="warning"
        />
        <StatCard
          label="Downloads"
          value={downloads30d === undefined ? "…" : String(downloads30d)}
          icon={Download}
          tone="neutral"
          sub="últimos 30 dias"
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.7fr_1fr]">
        {/* Dossiê */}
        <Card className="gap-0 py-0">
          <div className="border-b p-5">
            <SectionHeader
              icon={FileText}
              title="Dossiê do engajamento"
              description="Tipo, versão, formatos e status."
              count={groups.length}
            />
          </div>
          {reports === undefined ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              Carregando…
            </div>
          ) : groups.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="Nenhum relatório gerado."
              description="Escolha o público e os formatos ao lado e clique em Gerar. Só entram achados aprovados ou publicados."
            />
          ) : (
            <div className="divide-y">
              {groups.map((g) => (
                <ReportGroupRow
                  key={g.id}
                  group={g}
                  minsAgo={minsAgo}
                  reprocessing={reprocessing === g.id}
                  deleting={deletingGroup === g.id}
                  toggling={togglingVisibility === g.id}
                  onToggleVisibility={(visible) =>
                    void toggleVisibility(g.id, visible)
                  }
                  onReprocess={() => void reprocess(g.id)}
                  onRemove={() =>
                    void removeGroup(
                      g.id,
                      AUDIENCE_LABEL[g.audience as ReportAudience] ??
                        g.audience,
                      g.version,
                    )
                  }
                  onDownload={download}
                  onPreview={openPreview}
                />
              ))}
            </div>
          )}
        </Card>

        {/* Modelos / geração */}
        <Card className="gap-0 py-0">
          <div className="border-b p-5">
            <SectionHeader
              icon={Plus}
              title="Modelos"
              description="Gere um novo dossiê."
            />
          </div>
          <div className="flex flex-col gap-3 p-4">
            <div>
              <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Formatos
              </span>
              <div className="flex gap-1.5">
                {ALL_FORMATS.map((f) => {
                  const on = formats.has(f);
                  return (
                    <button
                      key={f}
                      type="button"
                      onClick={() => toggleFormat(f)}
                      className={cn(
                        "rounded-md border px-3 py-1.5 text-xs font-medium uppercase transition-colors",
                        on
                          ? "border-primary bg-primary/10 text-primary"
                          : "text-muted-foreground hover:bg-muted/40",
                      )}
                    >
                      {f}
                    </button>
                  );
                })}
              </div>
            </div>

            {GENERATABLE_AUDIENCES.map((a) => (
              <div
                key={a}
                className="flex items-center gap-3 rounded-xl border bg-card p-3 shadow-[var(--shadow-soft)]"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <FileText className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{AUDIENCE_LABEL[a]}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {AUDIENCE_DESC[a]}
                  </div>
                </div>
                <Button
                  size="sm"
                  onClick={() => void generate(a)}
                  disabled={generatingAudience !== null || formats.size === 0}
                >
                  {generatingAudience === a ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  Gerar
                </Button>
              </div>
            ))}

            <Callout tone="neutral">
              Os relatórios são montados a partir dos achados aprovados ou
              publicados no engajamento. Cada geração cria uma nova versão.
            </Callout>
          </div>
        </Card>
      </div>
    </>
  );
}

function ReportGroupRow({
  group: g,
  minsAgo,
  reprocessing,
  deleting,
  toggling,
  onToggleVisibility,
  onReprocess,
  onRemove,
  onDownload,
  onPreview,
}: {
  group: ReportGroup;
  minsAgo: (ms: number) => number;
  reprocessing: boolean;
  deleting: boolean;
  toggling: boolean;
  onToggleVisibility: (visible: boolean) => void;
  onReprocess: () => void;
  onRemove: () => void;
  onDownload: (id: Id<"reports">) => void;
  onPreview: (id: Id<"reports">) => void;
}) {
  const allReady = g.rows.every((r) => r.status === "ready");
  const anyPending = g.rows.some(
    (r) => r.status === "queued" || r.status === "rendering",
  );
  const anyFailed = g.rows.some((r) => r.status === "failed");
  const mins = minsAgo(g.created_at);
  const stuck = anyPending && mins >= 3;
  // Visível ao cliente a menos que algum formato esteja explicitamente oculto
  // (o toggle sempre grava todos os formatos do grupo juntos → consistente).
  const clientVisible = g.rows.every((r) => r.client_visible !== false);

  return (
    <div className="p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="font-medium">
          {AUDIENCE_LABEL[g.audience as ReportAudience] ?? g.audience}
        </span>
        <span className="text-xs text-muted-foreground">
          v{g.version} · {formatDateTime(g.created_at)}
        </span>
        {g.title && (
          <span className="hidden text-xs text-muted-foreground sm:inline">
            · {g.title}
          </span>
        )}
        {anyPending ? (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]",
              stuck
                ? "bg-warning/15 text-warning"
                : "bg-primary/10 text-primary",
            )}
          >
            <Loader2 className="h-3 w-3 animate-spin" />
            {stuck ? "Sem progresso" : "Gerando"} · há {mins} min
          </span>
        ) : anyFailed ? (
          <StatusBadge tone="destructive" label="Falhou" />
        ) : allReady ? (
          <StatusBadge tone="success" label="Pronto" />
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => onToggleVisibility(!clientVisible)}
            disabled={toggling}
            title={
              clientVisible
                ? "Visível ao cliente no portal — clique para ocultar"
                : "Oculto do cliente — clique para tornar visível"
            }
            className={cn(
              "inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs disabled:opacity-50",
              clientVisible
                ? "border-success/30 text-success hover:bg-success/10"
                : "border-border text-muted-foreground hover:bg-muted/40",
            )}
          >
            {toggling ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : clientVisible ? (
              <Eye className="h-3.5 w-3.5" />
            ) : (
              <EyeOff className="h-3.5 w-3.5" />
            )}
            {clientVisible ? "Visível ao cliente" : "Oculto"}
          </button>
          {!allReady && (
            <button
              onClick={onReprocess}
              disabled={reprocessing}
              title="Redisparar a geração (útil se travou na fila)"
              className="inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs text-primary hover:bg-primary/10 disabled:opacity-50"
            >
              {reprocessing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Reprocessar
            </button>
          )}
          <button
            onClick={onRemove}
            disabled={deleting}
            title="Remover este relatório (todos os formatos)"
            className="inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
          >
            {deleting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
            Remover
          </button>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {g.rows
          .slice()
          .sort((a, b) => a.format.localeCompare(b.format))
          .map((r) => {
            const status = r.status as ReportStatus;
            const ready = status === "ready";
            return (
              <div
                key={r._id}
                className="flex items-center gap-2 rounded-lg border px-3 py-2"
              >
                <span className="text-xs font-semibold uppercase">
                  {r.format}
                </span>
                <StatusBadge
                  tone={REPORT_STATUS_TONE[status] ?? "neutral"}
                  label={REPORT_STATUS_LABEL[status] ?? status}
                />
                {ready && (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onPreview(r._id)}
                      title="Pré-visualizar páginas e evidências"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      Prévia
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onDownload(r._id)}
                    >
                      <Download className="h-3.5 w-3.5" />
                      Baixar
                    </Button>
                  </>
                )}
                {status === "failed" && r.error && (
                  <span
                    className="max-w-[16rem] truncate text-xs text-destructive"
                    title={r.error}
                  >
                    {r.error}
                  </span>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}
