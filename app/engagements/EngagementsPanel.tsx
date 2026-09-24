"use client";

import { useMemo, useState } from "react";
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

  const submit = useMutation(api.findings.submitForReview);
  const approve = useMutation(api.findings.approveFinding);
  const publish = useMutation(api.findings.publishFinding);
  const dismiss = useMutation(api.findings.dismissFinding);
  const reopen = useMutation(api.findings.reopenFinding);

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
        <div className="border-b p-5">
          <SectionHeader title="Achados" count={findings?.length} />
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
          {chats === undefined ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              Carregando…
            </div>
          ) : chats.length === 0 ? (
            <EmptyState
              icon={MessagesSquare}
              title="Nenhum chat anexado."
              description="O agente anexa o chat ao capturar um achado; você também pode anexar manualmente (em breve)."
            />
          ) : (
            <div className="divide-y">
              {chats.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm"
                >
                  <span className="truncate">{c.title}</span>
                  {c.active_trigger_run_id ? (
                    <span className="flex items-center gap-1 text-xs text-success">
                      <Radio className="h-3 w-3" /> ativo
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {formatDateTime(c.update_time)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
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
    weakness_class: string;
    cvss_vector?: string;
    cwe?: string;
  };
}) {
  const evidence = useQuery(api.findings.listEvidenceForFinding, { findingId });
  return (
    <div className="mt-3 space-y-3 rounded-lg border bg-muted/20 p-3 text-sm">
      <div className="grid gap-2 sm:grid-cols-2">
        <Detail label="Classe" value={finding.weakness_class} />
        <Detail label="CVSS" value={finding.cvss_vector} />
        <Detail label="CWE" value={finding.cwe} />
      </div>
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
          Evidência ({evidence?.length ?? 0})
        </div>
        {evidence === undefined ? (
          <div className="text-xs text-muted-foreground">Carregando…</div>
        ) : evidence.length === 0 ? (
          <Callout tone="warning">
            Sem evidência — aprovar exige ao menos uma evidência.
          </Callout>
        ) : (
          <div className="space-y-2">
            {evidence.map((ev) => (
              <div key={ev._id} className="rounded border bg-background p-2">
                <div className="text-xs font-medium text-muted-foreground">
                  {ev.source_type}
                  {ev.label ? ` · ${ev.label}` : ""}
                </div>
                {ev.snippet && (
                  <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs">
                    {ev.snippet}
                  </pre>
                )}
              </div>
            ))}
          </div>
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
