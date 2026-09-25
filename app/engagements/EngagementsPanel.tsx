"use client";

import { useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
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
  Download,
  Loader2,
  Sparkles,
  ExternalLink,
  Upload,
  Trash2,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
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

type Severity = "info" | "low" | "medium" | "high" | "critical";
type FindingStatus =
  "draft" | "in_review" | "approved" | "published" | "dismissed";

const SEVERITY_TONE: Record<Severity, Tone> = {
  critical: "destructive",
  high: "destructive",
  medium: "warning",
  low: "primary",
  info: "neutral",
};
const STATUS_TONE: Record<FindingStatus, Tone> = {
  draft: "neutral",
  in_review: "warning",
  approved: "success",
  published: "brand",
  dismissed: "destructive",
};
const STATUS_LABEL: Record<FindingStatus, string> = {
  draft: "Rascunho",
  in_review: "Em revisão",
  approved: "Aprovado",
  published: "Publicado",
  dismissed: "Descartado",
};

export function EngagementsPanel() {
  const clients = useQuery(api.clients.listClients);
  const engagements = useQuery(api.engagements.listEngagements, {});

  const [selectedEngagementId, setSelectedEngagementId] =
    useState<Id<"engagements"> | null>(null);
  const [expandedFindingId, setExpandedFindingId] =
    useState<Id<"findings"> | null>(null);
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
    <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-5 px-4 py-6">
      <SectionHeader
        icon={ShieldAlert}
        title="Engajamentos"
        description="Clientes, engajamentos, achados e evidência em tempo real. Os achados capturados pelo agente entram como rascunho para sua curadoria."
      />

      {/* Criação rápida */}
      <Card className="gap-0 py-0">
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
            <Button variant="outline" onClick={() => void handleCreateClient()}>
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
          <div className="flex flex-wrap gap-2 p-4">
            {engagements.map((e) => (
              <button
                key={e._id}
                onClick={() =>
                  setSelectedEngagementId(
                    selectedEngagementId === e._id ? null : e._id,
                  )
                }
                className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                  selectedEngagementId === e._id
                    ? "border-primary bg-primary/10"
                    : "hover:bg-muted/40"
                }`}
              >
                <div className="font-medium">{e.name}</div>
                <div className="text-xs text-muted-foreground">
                  {clientNameById.get(e.client_id) ?? "—"} · {e.status}
                </div>
              </button>
            ))}
          </div>
        )}
      </Card>

      {selectedEngagementId && (
        <EngagementDetail
          engagementId={selectedEngagementId}
          expandedFindingId={expandedFindingId}
          setExpandedFindingId={setExpandedFindingId}
        />
      )}
    </div>
  );
}

function EngagementDetail({
  engagementId,
  expandedFindingId,
  setExpandedFindingId,
}: {
  engagementId: Id<"engagements">;
  expandedFindingId: Id<"findings"> | null;
  setExpandedFindingId: (id: Id<"findings"> | null) => void;
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

  const submit = useMutation(api.findings.submitForReview);
  const approve = useMutation(api.findings.approveFinding);
  const publish = useMutation(api.findings.publishFinding);
  const dismiss = useMutation(api.findings.dismissFinding);
  const reopen = useMutation(api.findings.reopenFinding);
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
    const c = { total: 0, published: 0, approved: 0, review: 0, draft: 0 };
    for (const f of findings ?? []) {
      c.total += 1;
      if (f.status === "published") c.published += 1;
      else if (f.status === "approved") c.approved += 1;
      else if (f.status === "in_review") c.review += 1;
      else if (f.status === "draft") c.draft += 1;
    }
    return c;
  }, [findings]);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast.success(ok);
    } catch (e) {
      const msg = e instanceof Error && e.message ? e.message : "Ação falhou.";
      toast.error(msg);
      console.error(e);
    }
  };

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="Achados"
          value={String(counts.total)}
          icon={ShieldAlert}
        />
        <StatCard
          label="Rascunho / revisão"
          value={String(counts.draft + counts.review)}
          icon={RefreshCw}
          tone="warning"
        />
        <StatCard
          label="Aprovados"
          value={String(counts.approved)}
          icon={ShieldAlert}
          tone="success"
        />
        <StatCard
          label="Publicados"
          value={String(counts.published)}
          icon={ShieldAlert}
          tone="brand"
        />
      </div>

      {/* Achados */}
      <Card className="gap-0 py-0">
        <div className="flex items-center justify-between gap-2 border-b p-5">
          <SectionHeader title="Achados" count={findings?.length} />
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
          <div className="divide-y">
            {findings.map((f) => {
              const status = f.status as FindingStatus;
              const severity = f.severity as Severity;
              const expanded = expandedFindingId === f._id;
              return (
                <div key={f._id} className="p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() =>
                        setExpandedFindingId(expanded ? null : f._id)
                      }
                      className="flex flex-1 items-center gap-2 text-left"
                    >
                      {expanded ? (
                        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                      <StatusBadge
                        tone={SEVERITY_TONE[severity]}
                        label={severity}
                        dot={false}
                      />
                      <span className="font-medium">{f.title}</span>
                      <span className="text-xs text-muted-foreground">
                        {f.affected_asset}
                      </span>
                    </button>
                    <StatusBadge
                      tone={STATUS_TONE[status]}
                      label={STATUS_LABEL[status]}
                    />
                    <div className="flex gap-1.5">
                      {status === "draft" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            void run(
                              () => submit({ findingId: f._id }),
                              "Enviado para revisão.",
                            )
                          }
                        >
                          Enviar p/ revisão
                        </Button>
                      )}
                      {status === "in_review" && (
                        <>
                          <Button
                            size="sm"
                            onClick={() =>
                              void run(
                                () => approve({ findingId: f._id }),
                                "Aprovado.",
                              )
                            }
                          >
                            Aprovar
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              void run(
                                () => dismiss({ findingId: f._id }),
                                "Descartado.",
                              )
                            }
                          >
                            Descartar
                          </Button>
                        </>
                      )}
                      {status === "approved" && (
                        <Button
                          size="sm"
                          onClick={() =>
                            void run(
                              () => publish({ findingId: f._id }),
                              "Publicado.",
                            )
                          }
                        >
                          Publicar
                        </Button>
                      )}
                      {(status === "approved" ||
                        status === "published" ||
                        status === "dismissed") && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            void run(
                              () => reopen({ findingId: f._id }),
                              "Reaberto em revisão.",
                            )
                          }
                        >
                          Reabrir
                        </Button>
                      )}
                    </div>
                  </div>
                  {expanded && (
                    <FindingEvidence findingId={f._id} finding={f} />
                  )}
                </div>
              );
            })}
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
      <ReportsSection engagementId={engagementId} />

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
            <div className="max-h-96 divide-y overflow-y-auto">
              {liveEvidence.map((ev) => (
                <div key={ev._id} className="px-4 py-2.5 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-muted-foreground">
                      {ev.source_type}
                      {ev.label ? ` · ${ev.label}` : ""}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatDateTime(ev.captured_at)}
                    </span>
                  </div>
                  {ev.snippet && (
                    <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/40 p-2 text-xs">
                      {ev.snippet}
                    </pre>
                  )}
                </div>
              ))}
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

type ReportAudience = "technical" | "executive" | "commercial";
type ReportFormat = "docx" | "pptx" | "pdf";
type ReportStatus = "queued" | "rendering" | "ready" | "failed";

const AUDIENCE_LABEL: Record<ReportAudience, string> = {
  technical: "Técnico",
  executive: "Executivo",
  commercial: "Ações comerciais",
};
const REPORT_STATUS_TONE: Record<ReportStatus, Tone> = {
  queued: "neutral",
  rendering: "warning",
  ready: "success",
  failed: "destructive",
};
const REPORT_STATUS_LABEL: Record<ReportStatus, string> = {
  queued: "Na fila",
  rendering: "Gerando…",
  ready: "Pronto",
  failed: "Falhou",
};
const ALL_FORMATS: ReportFormat[] = ["docx", "pptx", "pdf"];

type ReportRow = {
  _id: Id<"reports">;
  report_group_id: string;
  audience: string;
  format: string;
  version: number;
  status: string;
  error?: string;
  size_bytes?: number;
  created_at: number;
};

function ReportsSection({ engagementId }: { engagementId: Id<"engagements"> }) {
  const reports = useQuery(api.reports.listReportsForEngagement, {
    engagementId,
  });

  const deleteReportGroup = useAction(
    api.reportActions.deleteReportGroupWithFiles,
  );

  const [audience, setAudience] = useState<ReportAudience>("technical");
  const [formats, setFormats] = useState<Set<ReportFormat>>(
    () => new Set<ReportFormat>(["pdf"]),
  );
  const [generating, setGenerating] = useState(false);
  const [deletingGroup, setDeletingGroup] = useState<string | null>(null);

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

  const toggleFormat = (f: ReportFormat) => {
    setFormats((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });
  };

  const generate = async () => {
    if (formats.size === 0) {
      toast.error("Selecione ao menos um formato.");
      return;
    }
    setGenerating(true);
    try {
      const res = await fetch("/api/reports/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          engagementId,
          audience,
          formats: [...formats],
        }),
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
      setGenerating(false);
    }
  };

  // Download por rota-proxy autenticada (sessão WorkOS via cookie); a rota
  // grava auditoria antes de servir e faz stream do S3 (sem bearer no browser).
  const download = (reportId: Id<"reports">) => {
    window.open(
      `/api/reports/${reportId}/download`,
      "_blank",
      "noopener,noreferrer",
    );
  };

  // Agrupa as linhas (uma por formato) por report_group_id, mais recentes no topo.
  const groups = useMemo(() => {
    const map = new Map<
      string,
      {
        id: string;
        audience: string;
        version: number;
        created_at: number;
        rows: ReportRow[];
      }
    >();
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
          rows: [r],
        });
      }
    }
    return [...map.values()].sort((a, b) => b.created_at - a.created_at);
  }, [reports]);

  return (
    <Card className="gap-0 py-0">
      <div className="border-b p-5">
        <SectionHeader
          icon={FileText}
          title="Relatórios"
          description="Gere relatórios a partir dos achados aprovados/publicados. Público × formato, versionado a cada geração."
          count={groups.length}
        />
      </div>

      {/* Controles de geração */}
      <div className="flex flex-col gap-3 border-b p-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Público
            </label>
            <select
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={audience}
              onChange={(e) => setAudience(e.target.value as ReportAudience)}
            >
              <option value="technical">Técnico</option>
              <option value="executive">Executivo</option>
              <option value="commercial">Ações comerciais</option>
            </select>
          </div>
          <div>
            <span className="mb-1 block text-xs font-medium text-muted-foreground">
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
                    className={`rounded-md border px-3 py-1.5 text-xs font-medium uppercase transition-colors ${
                      on
                        ? "border-primary bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-muted/40"
                    }`}
                  >
                    {f}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <Button
          onClick={() => void generate()}
          disabled={generating || formats.size === 0}
        >
          {generating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <FileText className="h-4 w-4" />
          )}
          Gerar relatório
        </Button>
      </div>

      {/* Lista de gerações */}
      {reports === undefined ? (
        <div className="p-6 text-center text-sm text-muted-foreground">
          Carregando…
        </div>
      ) : groups.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="Nenhum relatório gerado."
          description="Escolha o público e os formatos acima e clique em Gerar. Só entram achados aprovados ou publicados."
        />
      ) : (
        <div className="divide-y">
          {groups.map((g) => (
            <div key={g.id} className="p-4">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="font-medium">
                  {AUDIENCE_LABEL[g.audience as ReportAudience] ?? g.audience}
                </span>
                <span className="text-xs text-muted-foreground">
                  v{g.version} · {formatDateTime(g.created_at)}
                </span>
                <button
                  onClick={() =>
                    void removeGroup(
                      g.id,
                      AUDIENCE_LABEL[g.audience as ReportAudience] ??
                        g.audience,
                      g.version,
                    )
                  }
                  disabled={deletingGroup === g.id}
                  title="Remover este relatório (todos os formatos)"
                  className="ml-auto inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                >
                  {deletingGroup === g.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                  Remover
                </button>
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
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => download(r._id)}
                          >
                            <Download className="h-3.5 w-3.5" />
                            Baixar
                          </Button>
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
          ))}
        </div>
      )}
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

function FindingEvidence({
  findingId,
  finding,
}: {
  findingId: Id<"findings">;
  finding: {
    description?: string;
    impact?: string;
    remediation?: string;
    narrative?: string;
    weakness_class: string;
    cvss_vector?: string;
    cwe?: string;
  };
}) {
  const evidenceRaw = useQuery(api.findings.listEvidenceForFinding, {
    findingId,
  });
  // Ordena pela cadeia (step_index; sem índice → pelo tempo de captura).
  const evidence = useMemo(() => {
    if (!evidenceRaw) return evidenceRaw;
    return evidenceRaw.slice().sort((a, b) => {
      const sa = a.step_index ?? Number.MAX_SAFE_INTEGER;
      const sb = b.step_index ?? Number.MAX_SAFE_INTEGER;
      return sa - sb || a.captured_at - b.captured_at;
    });
  }, [evidenceRaw]);

  return (
    <div className="mt-3 space-y-3 rounded-lg border bg-muted/20 p-3 text-sm">
      <div className="grid gap-2 sm:grid-cols-2">
        <Detail label="Classe" value={finding.weakness_class} />
        <Detail label="CVSS" value={finding.cvss_vector} />
        <Detail label="CWE" value={finding.cwe} />
      </div>
      {finding.narrative && (
        <Detail label="Narrativa" value={finding.narrative} block />
      )}
      {finding.description && (
        <Detail label="Descrição" value={finding.description} block />
      )}
      {finding.impact && (
        <Detail label="Impacto" value={finding.impact} block />
      )}
      {finding.remediation && (
        <Detail label="Remediação" value={finding.remediation} block />
      )}
      <div>
        <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Cadeia de evidência ({evidence?.length ?? 0})
        </div>
        {evidence === undefined ? (
          <div className="text-xs text-muted-foreground">Carregando…</div>
        ) : evidence.length === 0 ? (
          <Callout tone="warning">
            Sem evidência — aprovar exige ao menos uma evidência.
          </Callout>
        ) : (
          <ol className="space-y-2">
            {evidence.map((ev, i) => (
              <li key={ev._id} className="rounded border bg-background p-2.5">
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">
                    {ev.step_index ?? i + 1}
                  </span>
                  {ev.tool_name && (
                    <span className="rounded bg-muted px-1.5 py-0.5 font-mono font-medium">
                      {ev.tool_name}
                    </span>
                  )}
                  <span className="text-muted-foreground">
                    {ev.source_type}
                    {ev.label ? ` · ${ev.label}` : ""}
                  </span>
                  {ev.file_id && (
                    <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                      📎 arquivo
                    </span>
                  )}
                </div>
                {ev.command && (
                  <pre className="mt-1.5 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/60 p-1.5 font-mono text-xs">
                    <span className="select-none text-muted-foreground">
                      ${" "}
                    </span>
                    {ev.command}
                  </pre>
                )}
                {ev.snippet && (
                  <pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/30 p-1.5 text-xs">
                    {ev.snippet}
                  </pre>
                )}
                {ev.result_summary && (
                  <div className="mt-1 text-xs text-muted-foreground">
                    <span className="font-medium text-success">→ prova:</span>{" "}
                    {ev.result_summary}
                  </div>
                )}
                {ev.file_id &&
                  (ev.media_type ?? "image/").startsWith("image/") && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/evidence/${ev._id}/image`}
                      alt={ev.label ?? "evidência"}
                      loading="lazy"
                      className="mt-2 max-h-96 w-auto max-w-full rounded border"
                      onError={(e) => {
                        e.currentTarget.style.display = "none";
                      }}
                    />
                  )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

function Detail({
  label,
  value,
  block,
}: {
  label: string;
  value?: string;
  block?: boolean;
}) {
  if (!value) return null;
  return (
    <div className={block ? "" : "min-w-0"}>
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <div className="whitespace-pre-wrap break-words">{value}</div>
    </div>
  );
}
