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
  Pencil,
  Target,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
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

// ── Escopo do engajamento (alvos autorizados + janela) ──────────────────────
// scopeItemArg (convex/engagements.ts): { kind, value, in_scope, note? }.
type ScopeKind = "domain" | "ip" | "cidr" | "url" | "app" | "other";
const SCOPE_KINDS: ScopeKind[] = ["domain", "ip", "cidr", "url", "app", "other"];
const SCOPE_KIND_LABEL: Record<ScopeKind, string> = {
  domain: "Domínio",
  ip: "IP",
  cidr: "CIDR",
  url: "URL",
  app: "App",
  other: "Outro",
};
type ScopeRow = {
  id: string;
  kind: ScopeKind;
  value: string;
  in_scope: boolean;
  note: string;
};

// starts_at/ends_at são ms epoch; o <input type="date"> trabalha em YYYY-MM-DD
// no fuso LOCAL do operador. Começo do dia p/ início, fim do dia p/ término,
// pra a janela de autorização incluir o dia final inteiro.
function toDateInputValue(ts?: number): string {
  if (typeof ts !== "number" || !Number.isFinite(ts)) return "";
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function dayStartMs(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
}
function dayEndMs(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
}
// Chave de "sujo": escopo normalizado (trim + sem linhas vazias) + janela + código.
function scopeDraftKey(
  rows: ScopeRow[],
  code: string,
  startsAt: string,
  endsAt: string,
): string {
  const scope = rows
    .map((r) => ({
      kind: r.kind,
      value: r.value.trim(),
      in_scope: r.in_scope,
      note: r.note.trim(),
    }))
    .filter((r) => r.value.length > 0);
  return JSON.stringify({ scope, code: code.trim(), startsAt, endsAt });
}

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
  const engagement = useQuery(api.engagements.getEngagement, { engagementId });
  const updateEngagement = useMutation(api.engagements.updateEngagement);

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

  // Rename manual do engajamento → reflete no título da task vinculada (1:1).
  const saveName = async () => {
    const name = nameDraft.trim();
    if (!name) {
      toast.error("O nome não pode ficar vazio.");
      return;
    }
    try {
      await updateEngagement({ engagementId, name });
      setEditingName(false);
      toast.success("Engajamento renomeado.");
    } catch (e) {
      toast.error("Falha ao renomear engajamento.");
      console.error(e);
    }
  };

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
      {/* Cabeçalho do engajamento: nome editável (espelha na task 1:1) */}
      <Card className="gap-0 py-0">
        <div className="flex items-center justify-between gap-3 p-5">
          {editingName ? (
            <div className="flex flex-1 items-center gap-2">
              <Input
                autoFocus
                value={nameDraft}
                maxLength={100}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void saveName();
                  else if (e.key === "Escape") setEditingName(false);
                }}
                placeholder="Nome do engajamento"
              />
              <Button size="sm" onClick={() => void saveName()}>
                Salvar
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setEditingName(false)}
              >
                Cancelar
              </Button>
            </div>
          ) : (
            <>
              <div className="min-w-0">
                <div className="truncate text-lg font-semibold">
                  {engagement?.name ?? "—"}
                </div>
                <div className="text-xs text-muted-foreground">
                  Renomear reflete no título da task vinculada (quando há só
                  uma).
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="shrink-0 gap-1.5"
                disabled={!engagement}
                onClick={() => {
                  setNameDraft(engagement?.name ?? "");
                  setEditingName(true);
                }}
              >
                <Pencil className="h-3.5 w-3.5" /> Renomear
              </Button>
            </>
          )}
        </div>
      </Card>

      {engagement && (
        <ScopeEditor key={engagement._id} engagement={engagement} />
      )}

      {engagement && (
        <ScheduleEditor key={engagement._id} engagement={engagement} />
      )}

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

// Editor de escopo + janela de autorização. Montado com key={engagement._id}
// (remonta ao trocar de engajamento → re-semeia); estado semeado nos
// inicializadores de useState (sem effects → sem set-state-in-effect).
function ScopeEditor({ engagement }: { engagement: Doc<"engagements"> }) {
  const updateEngagement = useMutation(api.engagements.updateEngagement);

  const [rows, setRows] = useState<ScopeRow[]>(() =>
    (engagement.scope ?? []).map((s) => ({
      id: crypto.randomUUID(),
      kind: s.kind,
      value: s.value,
      in_scope: s.in_scope,
      note: s.note ?? "",
    })),
  );
  const [code, setCode] = useState(() => engagement.code ?? "");
  const [startsAt, setStartsAt] = useState(() =>
    toDateInputValue(engagement.starts_at),
  );
  const [endsAt, setEndsAt] = useState(() =>
    toDateInputValue(engagement.ends_at),
  );
  const [saving, setSaving] = useState(false);
  // Snapshot inicial p/ detectar "sujo" — recomputado da mesma fonte que semeia.
  const [initialSnap, setInitialSnap] = useState(() =>
    scopeDraftKey(
      (engagement.scope ?? []).map((s) => ({
        id: "",
        kind: s.kind,
        value: s.value,
        in_scope: s.in_scope,
        note: s.note ?? "",
      })),
      engagement.code ?? "",
      toDateInputValue(engagement.starts_at),
      toDateInputValue(engagement.ends_at),
    ),
  );

  const currentKey = useMemo(
    () => scopeDraftKey(rows, code, startsAt, endsAt),
    [rows, code, startsAt, endsAt],
  );
  const dirty = currentKey !== initialSnap;

  const addRow = () =>
    setRows((rs) => [
      ...rs,
      {
        id: crypto.randomUUID(),
        kind: "domain",
        value: "",
        in_scope: true,
        note: "",
      },
    ]);
  const patchRow = (id: string, patch: Partial<ScopeRow>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const removeRow = (id: string) =>
    setRows((rs) => rs.filter((r) => r.id !== id));

  const save = async () => {
    const scope = rows
      .map((r) => ({
        kind: r.kind,
        value: r.value.trim(),
        in_scope: r.in_scope,
        note: r.note.trim() || undefined,
      }))
      .filter((r) => r.value.length > 0);
    const startsMs = startsAt ? dayStartMs(startsAt) : undefined;
    const endsMs = endsAt ? dayEndMs(endsAt) : undefined;
    if (startsMs !== undefined && endsMs !== undefined && endsMs < startsMs) {
      toast.error("A data final da autorização é anterior à inicial.");
      return;
    }
    setSaving(true);
    try {
      // Datas vazias passam undefined (no-op na mutation); limpar uma data já
      // definida não é suportado nesta v1 (campo opcional não aceita null).
      await updateEngagement({
        engagementId: engagement._id,
        scope,
        code: code.trim(),
        ...(startsMs !== undefined ? { startsAt: startsMs } : {}),
        ...(endsMs !== undefined ? { endsAt: endsMs } : {}),
      });
      setInitialSnap(currentKey);
      toast.success(
        "Escopo salvo. O agente recebe estes alvos nas execuções vinculadas.",
      );
    } catch (e) {
      toast.error("Falha ao salvar o escopo.");
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  const inScopeCount = rows.filter((r) => r.in_scope && r.value.trim()).length;
  const outScopeCount = rows.filter(
    (r) => !r.in_scope && r.value.trim(),
  ).length;

  return (
    <Card className="gap-0 py-0">
      <div className="flex items-center justify-between gap-3 border-b p-5">
        <SectionHeader
          icon={Target}
          title="Escopo & autorização"
          description="Alvos autorizados do engajamento. O agente de pentest recebe este escopo (e as exclusões) no contexto a cada execução vinculada."
        />
        <Button
          size="sm"
          onClick={() => void save()}
          disabled={!dirty || saving}
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Salvar escopo
        </Button>
      </div>
      <CardContent className="flex flex-col gap-4 p-5">
        <div className="flex flex-col gap-2">
          {rows.length === 0 ? (
            <p className="rounded-lg border border-dashed bg-muted/20 px-3 py-4 text-center text-xs text-muted-foreground">
              Nenhum alvo definido. Adicione domínios, IPs, faixas CIDR, URLs ou
              apps — e marque o que está fora de escopo.
            </p>
          ) : (
            rows.map((r) => (
              <div
                key={r.id}
                className="flex flex-col gap-2 rounded-lg border bg-card p-2.5 sm:flex-row sm:items-center"
              >
                <select
                  className="h-9 shrink-0 rounded-md border bg-background px-2 text-sm"
                  value={r.kind}
                  onChange={(e) =>
                    patchRow(r.id, { kind: e.target.value as ScopeKind })
                  }
                >
                  {SCOPE_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {SCOPE_KIND_LABEL[k]}
                    </option>
                  ))}
                </select>
                <Input
                  className="flex-1 font-mono text-sm"
                  placeholder="alvo (ex.: app.cliente.com, 10.0.0.0/24)"
                  value={r.value}
                  onChange={(e) => patchRow(r.id, { value: e.target.value })}
                />
                <button
                  type="button"
                  onClick={() => patchRow(r.id, { in_scope: !r.in_scope })}
                  className={cn(
                    "inline-flex h-9 shrink-0 items-center justify-center rounded-md border px-2.5 text-xs font-semibold transition-colors",
                    r.in_scope
                      ? "border-success/30 bg-success/10 text-success"
                      : "border-destructive/30 bg-destructive/10 text-destructive",
                  )}
                  title="Alternar em escopo / fora de escopo"
                >
                  {r.in_scope ? "Em escopo" : "Excluído"}
                </button>
                <Input
                  className="text-sm sm:max-w-[12rem]"
                  placeholder="nota (opcional)"
                  value={r.note}
                  onChange={(e) => patchRow(r.id, { note: e.target.value })}
                />
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => removeRow(r.id)}
                  title="Remover alvo"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))
          )}
        </div>

        <div className="flex items-center justify-between gap-2">
          <Button variant="outline" size="sm" onClick={addRow}>
            <Plus className="h-4 w-4" /> Adicionar alvo
          </Button>
          {rows.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {inScopeCount} em escopo · {outScopeCount} excluído(s)
            </span>
          )}
        </div>

        <div className="grid gap-3 border-t pt-4 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Código do engajamento
            </label>
            <Input
              placeholder="ex.: PENTEST-2026-014"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Autorizado a partir de
            </label>
            <input
              type="date"
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              value={startsAt}
              max={endsAt || undefined}
              onChange={(e) => setStartsAt(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Autorizado até
            </label>
            <input
              type="date"
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              value={endsAt}
              min={startsAt || undefined}
              onChange={(e) => setEndsAt(e.target.value)}
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          A janela de autorização delimita quando o pentest pode rodar. A
          recorrência (em breve) não dispara execuções após a data final.
        </p>
      </CardContent>
    </Card>
  );
}

// Recorrência (reavaliação agendada). Lê o agendamento ao vivo; o form usa
// defaults (sem semear do query async → sem effects/lint). Pausar/retomar/remover
// agem direto no agendamento existente.
const SCHEDULE_STATUS_TONE: Record<string, Tone> = {
  active: "success",
  dispatching: "primary",
  paused: "warning",
};
const SCHEDULE_STATUS_LABEL: Record<string, string> = {
  active: "Ativa",
  dispatching: "Processando",
  paused: "Pausada",
};
const SCHEDULE_LAST_LABEL: Record<string, string> = {
  ok: "rascunho criado",
  failed: "falhou",
  authorization_expired: "pausada: janela de autorização expirada",
};

function ScheduleEditor({ engagement }: { engagement: Doc<"engagements"> }) {
  const schedule = useQuery(api.engagements.getScheduleForEngagement, {
    engagementId: engagement._id,
  });
  const setSchedule = useMutation(api.engagements.setScheduleForEngagement);
  const pauseSchedule = useMutation(api.engagements.pauseScheduleForEngagement);
  const removeSchedule = useMutation(
    api.engagements.removeScheduleForEngagement,
  );

  const [intervalDays, setIntervalDays] = useState("30");
  const [firstRun, setFirstRun] = useState(() =>
    toDateInputValue(Date.now() + 30 * 24 * 60 * 60 * 1000),
  );
  const [busy, setBusy] = useState(false);
  const exists = !!schedule;

  const applySchedule = async () => {
    const n = Number(intervalDays);
    if (!Number.isFinite(n) || n < 1 || n > 365) {
      toast.error("Intervalo deve ficar entre 1 e 365 dias.");
      return;
    }
    if (!firstRun) {
      toast.error("Escolha a data da próxima execução.");
      return;
    }
    setBusy(true);
    try {
      await setSchedule({
        engagementId: engagement._id,
        intervalDays: n,
        nextRunAt: dayStartMs(firstRun),
      });
      toast.success(
        exists ? "Agendamento atualizado." : "Recorrência ativada.",
      );
    } catch {
      toast.error("Falha ao salvar o agendamento.");
    } finally {
      setBusy(false);
    }
  };

  const togglePause = async (paused: boolean) => {
    setBusy(true);
    try {
      await pauseSchedule({ engagementId: engagement._id, paused });
      toast.success(paused ? "Recorrência pausada." : "Recorrência retomada.");
    } catch {
      toast.error("Falha ao alterar o agendamento.");
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async () => {
    if (!window.confirm("Remover a recorrência deste engajamento?")) return;
    setBusy(true);
    try {
      await removeSchedule({ engagementId: engagement._id });
      toast.success("Recorrência removida.");
    } catch {
      toast.error("Falha ao remover a recorrência.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="gap-0 py-0">
      <div className="flex items-center justify-between gap-3 border-b p-5">
        <SectionHeader
          icon={RefreshCw}
          title="Recorrência (reavaliação agendada)"
          description="Agenda rascunhos de reavaliação no mesmo escopo. Cada ciclo cria um chat pronto para o operador lançar — nunca roda sozinho — e respeita a janela de autorização."
        />
        {schedule && (
          <StatusBadge
            tone={SCHEDULE_STATUS_TONE[schedule.status] ?? "neutral"}
            label={SCHEDULE_STATUS_LABEL[schedule.status] ?? schedule.status}
          />
        )}
      </div>
      <CardContent className="flex flex-col gap-4 p-5">
        {schedule === undefined ? (
          <div className="text-sm text-muted-foreground">Carregando…</div>
        ) : (
          <>
            {schedule && (
              <div className="flex flex-col gap-1 rounded-lg border bg-card p-3 text-sm">
                <div>
                  A cada <strong>{schedule.interval_days}</strong> dia(s) ·
                  próxima:{" "}
                  <strong>{formatDateTime(schedule.next_run_at)}</strong>
                </div>
                {schedule.last_dispatched_at && (
                  <div className="text-xs text-muted-foreground">
                    Último rascunho: {formatDateTime(schedule.last_dispatched_at)}
                    {schedule.last_chat_id && (
                      <>
                        {" · "}
                        <a
                          href={`/c/${schedule.last_chat_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline"
                        >
                          abrir chat
                        </a>
                      </>
                    )}
                    {schedule.last_status && (
                      <>
                        {" · "}
                        {SCHEDULE_LAST_LABEL[schedule.last_status] ??
                          schedule.last_status}
                      </>
                    )}
                  </div>
                )}
                {schedule.last_error && (
                  <div className="text-xs text-destructive">
                    Erro: {schedule.last_error}
                  </div>
                )}
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Intervalo (dias)
                </label>
                <Input
                  type="number"
                  min={1}
                  max={365}
                  value={intervalDays}
                  onChange={(e) => setIntervalDays(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  {exists ? "Reagendar próxima para" : "Primeira execução"}
                </label>
                <input
                  type="date"
                  className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                  value={firstRun}
                  onChange={(e) => setFirstRun(e.target.value)}
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={() => void applySchedule()} disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {exists ? "Atualizar agendamento" : "Ativar recorrência"}
              </Button>
              {schedule && schedule.status !== "paused" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void togglePause(true)}
                  disabled={busy}
                >
                  Pausar
                </Button>
              )}
              {schedule && schedule.status === "paused" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void togglePause(false)}
                  disabled={busy}
                >
                  Retomar
                </Button>
              )}
              {exists && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void handleRemove()}
                  disabled={busy}
                  className="text-muted-foreground hover:text-destructive"
                >
                  Remover
                </Button>
              )}
            </div>

            {!engagement.ends_at && (
              <p className="text-xs text-muted-foreground">
                Defina a janela de autorização no bloco de escopo acima — sem
                data final, a recorrência não tem limite de autorização.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
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
