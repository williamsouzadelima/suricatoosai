"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import {
  Plus,
  RefreshCw,
  ChevronRight,
  ChevronDown,
  ShieldAlert,
  Radio,
  MessagesSquare,
  FileText,
  Loader2,
  Sparkles,
  ExternalLink,
  Upload,
  Trash2,
  Server,
  BarChart3,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  SectionHeader,
  StatCard,
  StatusBadge,
  EmptyState,
  Callout,
  formatDateTime,
  type Tone,
} from "@/app/admin/_ui";
import { ReportBrandCard } from "./ReportBrandCard";
import { EngagementBilling } from "./EngagementBilling";
import { AppShell } from "@/components/internal/app-shell";
import {
  FindingsBoard,
  SEV_LABEL,
  SEV_PILL,
  SEV_STRIPE,
  type Severity,
} from "@/components/internal/findings";

// Severity/FindingStatus + SEV_*/STATUS_*/RETEST_BADGE + FindingActions/
// FindingEvidence/FindingsBoard vivem em components/internal/findings.tsx
// (fonte única). SEV_LABEL/SEV_PILL/SEV_STRIPE + Severity importados acima.
const ENG_STATUS_TONE: Record<string, Tone> = {
  planned: "neutral",
  active: "success",
  review: "warning",
  reporting: "primary",
  closed: "neutral",
};
const ENG_STATUS_LABEL: Record<string, string> = {
  planned: "Planejado",
  active: "Ativo",
  review: "Em revisão",
  reporting: "Relatório",
  closed: "Fechado",
};

export function EngagementsPanel({
  userEmail,
  userRole,
}: {
  userEmail?: string;
  userRole?: string;
}) {
  const clients = useQuery(api.clients.listClients);
  const engagements = useQuery(api.engagements.listEngagements, {});

  const [selectedEngagementId, setSelectedEngagementId] =
    useState<Id<"engagements"> | null>(null);
  const [newClientName, setNewClientName] = useState("");
  const [newEngName, setNewEngName] = useState("");
  const [newEngClientId, setNewEngClientId] = useState<Id<"clients"> | "">("");

  const createClient = useMutation(api.clients.createClient);
  const createEngagement = useMutation(api.engagements.createEngagement);

  const clientNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of clients ?? []) map.set(c._id, c.name);
    return map;
  }, [clients]);

  const handleCreateClient = async () => {
    const name = newClientName.trim();
    if (!name) return;
    try {
      await createClient({ name });
      setNewClientName("");
      toast.success(`Cliente "${name}" criado.`);
    } catch (e) {
      toast.error("Falha ao criar cliente.");
      console.error(e);
    }
  };

  const handleCreateEngagement = async () => {
    const name = newEngName.trim();
    if (!name || !newEngClientId) return;
    try {
      await createEngagement({ name, clientId: newEngClientId });
      setNewEngName("");
      toast.success(`Engajamento "${name}" criado.`);
    } catch (e) {
      toast.error("Falha ao criar engajamento.");
      console.error(e);
    }
  };

  return (
    <AppShell
      active="engagements"
      title="Engajamentos"
      description="Clientes, engajamentos, achados e evidência em tempo real. Os achados capturados pelo agente entram como rascunho para sua curadoria."
      icon={ShieldAlert}
      breadcrumb={["Engajamentos"]}
      userEmail={userEmail}
      userRole={userRole}
    >
      <div className="flex flex-col gap-5">
        {/* Criação rápida */}
        <Card className="gap-0 py-0">
          <div className="border-b p-5">
            <SectionHeader
              icon={Sparkles}
              title="Ações rápidas"
              description="Cadastre um cliente ou abra um novo engajamento de pentest."
            />
          </div>
          <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex flex-1 items-end gap-2">
              <div className="flex-1">
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Novo cliente
                </label>
                <Input
                  placeholder="Nome do cliente"
                  value={newClientName}
                  onChange={(e) => setNewClientName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCreateClient()}
                />
              </div>
              <Button
                variant="outline"
                onClick={() => void handleCreateClient()}
              >
                <Plus className="h-4 w-4" /> Cliente
              </Button>
            </div>
            <div className="flex flex-1 items-end gap-2">
              <div className="flex-1">
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Novo engajamento
                </label>
                <div className="flex gap-2">
                  <select
                    className="h-9 rounded-md border bg-background px-2 text-sm"
                    value={newEngClientId}
                    onChange={(e) =>
                      setNewEngClientId(e.target.value as Id<"clients"> | "")
                    }
                  >
                    <option value="">Cliente…</option>
                    {(clients ?? []).map((c) => (
                      <option key={c._id} value={c._id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <Input
                    placeholder="Nome do engajamento"
                    value={newEngName}
                    onChange={(e) => setNewEngName(e.target.value)}
                    onKeyDown={(e) =>
                      e.key === "Enter" && handleCreateEngagement()
                    }
                  />
                </div>
              </div>
              <Button
                variant="outline"
                onClick={() => void handleCreateEngagement()}
              >
                <Plus className="h-4 w-4" /> Engajamento
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Marca dos relatórios (colapsável) */}
        <ReportBrandCard />

        {/* Lista de engajamentos */}
        <Card className="gap-0 py-0">
          <div className="border-b p-5">
            <SectionHeader
              title="Selecionar engajamento"
              count={engagements?.length}
            />
          </div>
          {engagements === undefined ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              Carregando…
            </div>
          ) : engagements.length === 0 ? (
            <EmptyState
              icon={ShieldAlert}
              title="Nenhum engajamento ainda."
              description="Crie um cliente e um engajamento acima. O agente também cria um engajamento de Triagem automaticamente ao capturar o primeiro achado."
            />
          ) : (
            <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
              {engagements.map((e) => {
                const active = selectedEngagementId === e._id;
                const st = e.status as string;
                return (
                  <button
                    key={e._id}
                    onClick={() =>
                      setSelectedEngagementId(active ? null : e._id)
                    }
                    className={cn(
                      "group rounded-xl border bg-card p-4 text-left shadow-[var(--shadow-soft)] transition-all hover:-translate-y-0.5 hover:shadow-[var(--shadow-card)]",
                      active &&
                        "border-primary ring-1 ring-primary shadow-[var(--shadow-card)]",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 font-medium leading-snug">
                        {e.name}
                      </div>
                      <StatusBadge
                        tone={ENG_STATUS_TONE[st] ?? "neutral"}
                        label={ENG_STATUS_LABEL[st] ?? st}
                      />
                    </div>
                    <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Server className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">
                        {clientNameById.get(e.client_id) ?? "—"}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </Card>

        {selectedEngagementId && (
          <EngagementDetail engagementId={selectedEngagementId} />
        )}
      </div>
    </AppShell>
  );
}

function EngagementDetail({
  engagementId,
}: {
  engagementId: Id<"engagements">;
}) {
  const findings = useQuery(api.findings.listFindingsForEngagement, {
    engagementId,
  });
  const liveEvidence = useQuery(api.findings.streamEngagementEvidence, {
    engagementId,
  });
  const chats = useQuery(api.engagements.getChatsForEngagement, {
    engagementId,
  });
  const recentChats = useQuery(
    api.engagementCapture.listRecentChatsForCapture,
    {},
  );

  const [pickChatId, setPickChatId] = useState<string>("");
  const [capturingChatId, setCapturingChatId] = useState<string | null>(null);
  const [expandedChatId, setExpandedChatId] = useState<string | null>(null);

  // Captura RETROATIVA por IA: anexa o chat ao engajamento e dispara o job que
  // lê a transcrição e grava achados em rascunho para curadoria.
  const captureFromChat = async (chatId: string) => {
    if (!chatId) return;
    setCapturingChatId(chatId);
    try {
      const res = await fetch("/api/engagements/extract-findings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId, engagementId }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || "Falha ao iniciar extração.");
      }
      toast.success(
        "Extração iniciada. Os achados aparecem em rascunho em instantes.",
      );
      setPickChatId("");
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Falha ao iniciar extração.",
      );
      console.error(e);
    } finally {
      setCapturingChatId(null);
    }
  };

  const [ingestingBundle, setIngestingBundle] = useState(false);

  // Importa um BUNDLE de evidências (tar.gz/zip): presigned → PUT no S3 →
  // dispara a task que extrai os artefatos e monta os achados.
  const ingestBundle = async (file: File) => {
    setIngestingBundle(true);
    try {
      const urlRes = await fetch("/api/engagements/bundle-upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, size: file.size }),
      });
      if (!urlRes.ok) {
        const j = (await urlRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || "Falha ao preparar upload.");
      }
      const { uploadUrl, s3Key, contentType } = (await urlRes.json()) as {
        uploadUrl: string;
        s3Key: string;
        contentType: string;
      };
      const put = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": contentType },
        body: file,
      });
      if (!put.ok) throw new Error("Falha ao enviar o bundle ao S3.");
      const ing = await fetch("/api/engagements/ingest-bundle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ engagementId, s3Key, filename: file.name }),
      });
      if (!ing.ok) {
        const j = (await ing.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || "Falha ao iniciar a ingestão.");
      }
      toast.success(
        "Bundle enviado. Os achados aparecem em rascunho em alguns minutos.",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao importar bundle.");
      console.error(e);
    } finally {
      setIngestingBundle(false);
    }
  };

  const approveAll = useMutation(api.findings.approveAllForEngagement);
  const clearFindings = useMutation(api.findings.clearFindingsForEngagement);
  const [approvingAll, setApprovingAll] = useState(false);
  const [clearing, setClearing] = useState(false);

  const handleClearFindings = async () => {
    if (
      !window.confirm(
        "Limpar TODOS os achados e evidências deste engajamento? Esta ação não pode ser desfeita (use para reingerir do zero).",
      )
    ) {
      return;
    }
    setClearing(true);
    try {
      const res = await clearFindings({ engagementId });
      toast.success(
        `${res.findings} achado(s) e ${res.evidence} evidência(s) removidos.`,
      );
    } catch (e) {
      toast.error("Falha ao limpar achados.");
      console.error(e);
    } finally {
      setClearing(false);
    }
  };

  const handleApproveAll = async () => {
    setApprovingAll(true);
    try {
      const res = await approveAll({ engagementId });
      toast.success(
        `${res.approved} achado(s) aprovado(s)${
          res.skipped ? `, ${res.skipped} pulado(s) (sem evidência)` : ""
        }.`,
      );
    } catch (e) {
      toast.error("Falha ao aprovar em massa.");
      console.error(e);
    } finally {
      setApprovingAll(false);
    }
  };

  const counts = useMemo(() => {
    const sev: Record<Severity, number> = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
    };
    const c = {
      total: 0,
      published: 0,
      approved: 0,
      review: 0,
      draft: 0,
      sev,
      maxCvss: 0,
    };
    for (const f of findings ?? []) {
      c.total += 1;
      if (f.status === "published") c.published += 1;
      else if (f.status === "approved") c.approved += 1;
      else if (f.status === "in_review") c.review += 1;
      else if (f.status === "draft") c.draft += 1;
      const s = f.severity as Severity;
      if (s in sev) sev[s] += 1;
      const cv = (f as { cvss_score?: number }).cvss_score;
      if (typeof cv === "number" && cv > c.maxCvss) c.maxCvss = cv;
    }
    return c;
  }, [findings]);

  return (
    <>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard
          label="Achados"
          value={String(counts.total)}
          icon={ShieldAlert}
          tone="primary"
          sub={`${counts.approved + counts.published} curados`}
        />
        <StatCard
          label="Críticos"
          value={String(counts.sev.critical)}
          icon={ShieldAlert}
          tone="destructive"
          sub={`${counts.sev.high} altos`}
        />
        <StatCard
          label="Maior CVSS"
          value={counts.maxCvss > 0 ? counts.maxCvss.toFixed(1) : "—"}
          icon={Sparkles}
          tone="warning"
        />
        <StatCard
          label="Rascunho / revisão"
          value={String(counts.draft + counts.review)}
          icon={RefreshCw}
          tone="warning"
          sub="aguardando curadoria"
        />
      </div>

      {counts.total > 0 && (
        <Card className="gap-0 py-0">
          <div className="p-5 pb-3">
            <SectionHeader
              icon={BarChart3}
              title="Distribuição por severidade"
              count={counts.total}
            />
          </div>
          <div className="space-y-2.5 px-5 pb-5">
            {(["critical", "high", "medium", "low", "info"] as Severity[]).map(
              (s) => {
                const n = counts.sev[s];
                const max = Math.max(1, ...Object.values(counts.sev));
                return (
                  <div key={s} className="flex items-center gap-3">
                    <span
                      className={cn(
                        "inline-flex w-[74px] shrink-0 justify-center rounded-full border px-2 py-0.5 text-xs font-semibold",
                        SEV_PILL[s],
                      )}
                    >
                      {SEV_LABEL[s]}
                    </span>
                    <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn("h-full rounded-full", SEV_STRIPE[s])}
                        style={{
                          width: `${n > 0 ? Math.max(4, (n / max) * 100) : 0}%`,
                        }}
                      />
                    </div>
                    <span className="w-6 shrink-0 text-right font-mono text-sm font-semibold tabular-nums">
                      {n}
                    </span>
                  </div>
                );
              },
            )}
          </div>
        </Card>
      )}

      {/* Achados */}
      <Card className="gap-0 py-0">
        <div className="flex items-center justify-between gap-2 border-b p-5">
          <SectionHeader title="Quadro de achados" count={findings?.length} />
          <div className="flex items-center gap-2">
            {counts.draft + counts.review > 0 && (
              <Button
                size="sm"
                onClick={() => void handleApproveAll()}
                disabled={approvingAll}
                title="Aprovar todos os achados com evidência (para entrarem no relatório)"
              >
                {approvingAll ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ShieldAlert className="h-4 w-4" />
                )}
                Aprovar todos
              </Button>
            )}
            {(findings?.length ?? 0) > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void handleClearFindings()}
                disabled={clearing}
                title="Apagar todos os achados e evidências deste engajamento"
                className="text-muted-foreground hover:text-destructive"
              >
                {clearing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
                Limpar achados
              </Button>
            )}
          </div>
        </div>
        {findings === undefined ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            Carregando…
          </div>
        ) : findings.length === 0 ? (
          <EmptyState
            icon={ShieldAlert}
            title="Sem achados neste engajamento."
            description="Achados capturados pelo agente (capture_finding) aparecem aqui em rascunho."
          />
        ) : (
          <div className="p-4">
            <FindingsBoard findings={findings} engagementId={engagementId} />
          </div>
        )}
      </Card>

      {/* Importar bundle de evidências */}
      <Card className="gap-0 py-0">
        <div className="flex flex-col gap-2 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <Upload className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <div>
              <div className="text-sm font-medium">
                Importar bundle de evidências
              </div>
              <div className="text-xs text-muted-foreground">
                Suba o .tar.gz/.zip da task (scripts, saídas, screenshots, .md).
                A IA usa o relatório .md como fonte e anexa os artefatos reais
                na cadeia de cada achado.
              </div>
            </div>
          </div>
          <label
            className={`inline-flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm font-medium ${
              ingestingBundle
                ? "pointer-events-none opacity-60"
                : "hover:bg-muted/40"
            }`}
          >
            {ingestingBundle ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            {ingestingBundle ? "Enviando…" : "Escolher bundle"}
            <input
              type="file"
              accept=".tar.gz,.tgz,.zip,application/gzip,application/zip,application/x-gzip"
              className="hidden"
              disabled={ingestingBundle}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void ingestBundle(file);
                e.target.value = "";
              }}
            />
          </label>
        </div>
      </Card>

      {/* Relatórios */}
      <ReportsSummary engagementId={engagementId} />

      {/* Faturamento (scaffold de monetização) */}
      <EngagementBilling engagementId={engagementId} />

      {/* Evidência ao vivo + chats */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="gap-0 py-0">
          <div className="flex items-center gap-2 border-b p-5">
            <Radio className="h-4 w-4 text-success" />
            <SectionHeader
              title="Evidência ao vivo"
              count={liveEvidence?.length}
            />
          </div>
          {liveEvidence === undefined ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              Carregando…
            </div>
          ) : liveEvidence.length === 0 ? (
            <EmptyState icon={Radio} title="Sem evidência ainda." />
          ) : (
            <div className="max-h-[26rem] space-y-3 overflow-y-auto p-4">
              {liveEvidence.map((ev) => {
                const tool = (ev as { tool_name?: string }).tool_name;
                return (
                  <div
                    key={ev._id}
                    className="rounded-xl border bg-card p-3 shadow-[var(--shadow-soft)]"
                  >
                    <div className="flex items-center gap-2">
                      {tool && (
                        <span className="rounded-md border border-primary/20 bg-primary/10 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-primary">
                          {tool}
                        </span>
                      )}
                      <span className="truncate text-xs text-muted-foreground">
                        {ev.source_type}
                        {ev.label ? ` · ${ev.label}` : ""}
                      </span>
                      <span className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground">
                        {formatDateTime(ev.captured_at)}
                      </span>
                    </div>
                    {ev.snippet && (
                      <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-[#0e1b2e] px-3 py-2 font-mono text-[11px] leading-relaxed text-[#d5e0f2]">
                        {ev.snippet}
                      </pre>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card className="gap-0 py-0">
          <div className="flex items-center gap-2 border-b p-5">
            <MessagesSquare className="h-4 w-4 text-muted-foreground" />
            <SectionHeader title="Chats anexados" count={chats?.length} />
          </div>

          {/* Captura retroativa: escolher uma task concluída → anexa + IA extrai achados */}
          <div className="flex flex-wrap items-end gap-2 border-b p-4">
            <div className="min-w-0 flex-1">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Capturar achados de uma task concluída (IA)
              </label>
              <select
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                value={pickChatId}
                onChange={(e) => setPickChatId(e.target.value)}
              >
                <option value="">Escolher task (chat)…</option>
                {(recentChats ?? [])
                  .filter((c) => !c.engagementId)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                      {c.active ? " (ativo)" : ""}
                    </option>
                  ))}
              </select>
            </div>
            <Button
              onClick={() => void captureFromChat(pickChatId)}
              disabled={!pickChatId || capturingChatId === pickChatId}
            >
              {pickChatId && capturingChatId === pickChatId ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              Capturar (IA)
            </Button>
          </div>

          {chats === undefined ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              Carregando…
            </div>
          ) : chats.length === 0 ? (
            <EmptyState
              icon={MessagesSquare}
              title="Nenhum chat anexado."
              description="Escolha uma task concluída acima para anexar e extrair os achados por IA — ou o agente anexa o chat automaticamente ao capturar um achado ao vivo."
            />
          ) : (
            <div className="divide-y">
              {chats.map((c) => {
                const expanded = expandedChatId === c.id;
                return (
                  <div key={c.id} className="px-4 py-2.5 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <button
                        onClick={() =>
                          setExpandedChatId(expanded ? null : c.id)
                        }
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                        title="Ver a transcrição da task"
                      >
                        {expanded ? (
                          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                        )}
                        <span className="min-w-0 flex-1 truncate">
                          {c.title}
                        </span>
                      </button>
                      {c.active_trigger_run_id ? (
                        <span className="flex items-center gap-1 text-xs text-success">
                          <Radio className="h-3 w-3" /> ativo
                        </span>
                      ) : (
                        <span className="hidden text-xs text-muted-foreground sm:inline">
                          {formatDateTime(c.update_time)}
                        </span>
                      )}
                      <a
                        href={`/c/${c.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex h-8 items-center gap-1 rounded-md border px-2 text-xs text-muted-foreground hover:bg-muted/40"
                        title="Abrir a task completa"
                      >
                        <ExternalLink className="h-3.5 w-3.5" /> Abrir
                      </a>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void captureFromChat(c.id)}
                        disabled={capturingChatId === c.id}
                        title="Extrair achados desta task por IA"
                      >
                        {capturingChatId === c.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Sparkles className="h-3.5 w-3.5" />
                        )}
                        Capturar
                      </Button>
                    </div>
                    {expanded && (
                      <div className="mt-2">
                        <ChatTranscriptView chatId={c.id} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

function ReportsSummary({ engagementId }: { engagementId: Id<"engagements"> }) {
  const reports = useQuery(api.reports.listReportsForEngagement, {
    engagementId,
  });
  const stats = useMemo(() => {
    const groups = new Map<string, string[]>();
    for (const r of reports ?? []) {
      const arr = groups.get(r.report_group_id);
      if (arr) arr.push(r.status);
      else groups.set(r.report_group_id, [r.status]);
    }
    let ready = 0;
    let pending = 0;
    for (const statuses of groups.values()) {
      if (statuses.every((s) => s === "ready")) ready += 1;
      if (statuses.some((s) => s === "queued" || s === "rendering"))
        pending += 1;
    }
    return { total: groups.size, ready, pending };
  }, [reports]);

  return (
    <Card className="gap-0 py-0">
      <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <FileText className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div>
            <div className="text-sm font-medium">Relatórios</div>
            <div className="text-xs text-muted-foreground">
              {reports === undefined
                ? "Carregando…"
                : `${stats.total} dossiê(s) · ${stats.ready} pronto(s)${
                    stats.pending ? ` · ${stats.pending} gerando` : ""
                  }`}
            </div>
          </div>
        </div>
        <Link
          href={`/relatorios?e=${engagementId}`}
          className="inline-flex h-9 shrink-0 items-center gap-2 rounded-md border px-3 text-sm font-medium hover:bg-muted/40"
        >
          <FileText className="h-4 w-4" /> Abrir Relatórios
          <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      </div>
    </Card>
  );
}

const CHAT_ROLE_LABEL: Record<string, string> = {
  user: "Operador",
  assistant: "Agente",
  system: "Sistema",
};

function ChatTranscriptView({ chatId }: { chatId: string }) {
  const transcript = useQuery(api.engagementCapture.getChatTranscriptForView, {
    chatId,
  });
  if (transcript === undefined) {
    return (
      <div className="rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground">
        Carregando transcrição…
      </div>
    );
  }
  if (transcript === null) {
    return (
      <Callout tone="warning">Sem acesso à transcrição desta task.</Callout>
    );
  }
  if (transcript.messages.length === 0) {
    return (
      <div className="rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground">
        Task sem conteúdo textual (ou muito antiga).
      </div>
    );
  }
  return (
    <div className="max-h-[28rem] space-y-3 overflow-y-auto rounded-lg border bg-muted/20 p-3">
      {transcript.messages.map((m) => (
        <div key={m.id}>
          <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
            {CHAT_ROLE_LABEL[m.role] ?? m.role}
          </div>
          <pre className="whitespace-pre-wrap break-words text-xs leading-relaxed">
            {m.text}
          </pre>
        </div>
      ))}
    </div>
  );
}

// FindingEvidence/MetaChip/EvBlock/SubHead foram extraídos para
// components/internal/findings.tsx (fonte única, compartilhada com /achados).
