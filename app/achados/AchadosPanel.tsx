"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import {
  Search,
  ShieldAlert,
  Sparkles,
  RefreshCw,
  Server,
  ChevronRight,
  ArrowLeft,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AppShell } from "@/components/internal/app-shell";
import {
  SectionHeader,
  StatCard,
  StatusBadge,
  EmptyState,
} from "@/app/admin/_ui";
import {
  FindingActions,
  FindingEvidence,
  SEV_LABEL,
  SEV_PILL,
  SEV_STRIPE,
  STATUS_LABEL,
  STATUS_TONE,
  RETEST_BADGE,
  type Severity,
  type FindingStatus,
} from "@/components/internal/findings";

/**
 * Seção Achados: visão centrada no achado (lista → detalhe full-width com a
 * cadeia de evidência). Escopada por engajamento; deep-link via ?e=&f= para o
 * board de Engajamentos conseguir abrir um achado direto.
 */
export function AchadosPanel({
  userEmail,
  userRole,
  initialEngagementId,
  initialFindingId,
}: {
  userEmail?: string;
  userRole?: string;
  initialEngagementId?: string;
  initialFindingId?: string;
}) {
  const clients = useQuery(api.clients.listClients);
  const engagements = useQuery(api.engagements.listEngagements, {});

  // Estado inicial vem do servidor (searchParams) → sem setState em effect e
  // sem mismatch de hidratação. ?e=&f= abre direto um achado (deep-link).
  const [selectedEngagementId, setSelectedEngagementId] =
    useState<Id<"engagements"> | null>(
      initialEngagementId ? (initialEngagementId as Id<"engagements">) : null,
    );
  const [openFindingId, setOpenFindingId] = useState<Id<"findings"> | null>(
    initialFindingId ? (initialFindingId as Id<"findings">) : null,
  );

  // Engajamento efetivo: o escolhido, ou o 1º da lista como default — derivado,
  // nunca via setState em effect.
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
    if (openFindingId) p.set("f", openFindingId);
    const qs = p.toString();
    window.history.replaceState(null, "", qs ? `/achados?${qs}` : "/achados");
  }, [effectiveEngagementId, openFindingId]);

  const crumbs = ["Achados", selectedEngagement?.name].filter(
    Boolean,
  ) as string[];

  return (
    <AppShell
      active="achados"
      title="Achados"
      description="Curadoria e evidência dos achados do engajamento. A cadeia de evidência mostra como cada vulnerabilidade foi descoberta e explorada."
      icon={Search}
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
              description="Escolha o engajamento para ver seus achados."
            />
            <select
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={effectiveEngagementId ?? ""}
              onChange={(e) => {
                setSelectedEngagementId(
                  (e.target.value || null) as Id<"engagements"> | null,
                );
                setOpenFindingId(null);
              }}
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
            icon={Search}
            title="Nenhum engajamento ainda."
            description="Crie um cliente e um engajamento na seção Engajamentos para começar a curar achados."
          />
        ) : (
          <AchadosForEngagement
            engagementId={effectiveEngagementId}
            openFindingId={openFindingId}
            setOpenFindingId={setOpenFindingId}
          />
        )}
      </div>
    </AppShell>
  );
}

function AchadosForEngagement({
  engagementId,
  openFindingId,
  setOpenFindingId,
}: {
  engagementId: Id<"engagements">;
  openFindingId: Id<"findings"> | null;
  setOpenFindingId: (id: Id<"findings"> | null) => void;
}) {
  const findings = useQuery(api.findings.listFindingsForEngagement, {
    engagementId,
  });

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

  const openFinding = useMemo(
    () => (findings ?? []).find((f) => f._id === openFindingId) ?? null,
    [findings, openFindingId],
  );

  if (openFinding) {
    return (
      <AchadoDetail
        finding={openFinding}
        onBack={() => setOpenFindingId(null)}
      />
    );
  }

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
          <div className="space-y-2.5 p-4">
            {findings.map((f) => (
              <FindingRow
                key={f._id}
                finding={f}
                onOpen={() => setOpenFindingId(f._id)}
              />
            ))}
          </div>
        )}
      </Card>
    </>
  );
}

function FindingRow({
  finding: f,
  onOpen,
}: {
  finding: Doc<"findings">;
  onOpen: () => void;
}) {
  const severity = f.severity as Severity;
  const status = f.status as FindingStatus;
  const cvss = typeof f.cvss_score === "number" ? f.cvss_score : undefined;
  const rs = f.retest_status;
  return (
    <button
      onClick={onOpen}
      className="relative flex w-full items-center gap-2.5 overflow-hidden rounded-xl border bg-card py-3.5 pl-5 pr-4 text-left shadow-[var(--shadow-soft)] transition-shadow hover:shadow-[var(--shadow-card)]"
    >
      <span
        className={cn(
          "absolute inset-y-3 left-0 w-1 rounded-r-full",
          SEV_STRIPE[severity],
        )}
      />
      <span className="flex min-w-0 flex-1 items-center gap-2.5">
        <span
          className={cn(
            "inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
            SEV_PILL[severity],
          )}
        >
          {SEV_LABEL[severity]}
        </span>
        {f.finding_id && (
          <span className="shrink-0 font-mono text-[11.5px] text-muted-foreground">
            {f.finding_id}
          </span>
        )}
        <span className="truncate font-medium">{f.title}</span>
        <span className="hidden shrink-0 items-center gap-1.5 text-xs text-muted-foreground sm:inline-flex">
          <Server className="h-3.5 w-3.5" />
          {f.affected_asset}
        </span>
        {cvss !== undefined && (
          <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] font-semibold text-muted-foreground">
            CVSS {cvss.toFixed(1)}
          </span>
        )}
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <StatusBadge tone={STATUS_TONE[status]} label={STATUS_LABEL[status]} />
        {rs && RETEST_BADGE[rs] && (
          <StatusBadge
            tone={RETEST_BADGE[rs].tone}
            label={RETEST_BADGE[rs].label}
          />
        )}
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </span>
    </button>
  );
}

function AchadoDetail({
  finding: f,
  onBack,
}: {
  finding: Doc<"findings">;
  onBack: () => void;
}) {
  const severity = f.severity as Severity;
  const status = f.status as FindingStatus;
  const cvss = typeof f.cvss_score === "number" ? f.cvss_score : undefined;
  const rs = f.retest_status;
  return (
    <Card className="gap-0 py-0">
      <div className="relative overflow-hidden rounded-t-xl">
        <span
          className={cn("absolute inset-y-0 left-0 w-1", SEV_STRIPE[severity])}
        />
        <div className="flex flex-col gap-3 border-b p-5 pl-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={onBack}
              className="text-muted-foreground"
            >
              <ArrowLeft className="h-4 w-4" /> Voltar aos achados
            </Button>
            <FindingActions findingId={f._id} status={status} />
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <span
              className={cn(
                "inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                SEV_PILL[severity],
              )}
            >
              {SEV_LABEL[severity]}
            </span>
            {f.finding_id && (
              <span className="font-mono text-xs text-muted-foreground">
                {f.finding_id}
              </span>
            )}
            <StatusBadge
              tone={STATUS_TONE[status]}
              label={STATUS_LABEL[status]}
            />
            {rs && RETEST_BADGE[rs] && (
              <StatusBadge
                tone={RETEST_BADGE[rs].tone}
                label={RETEST_BADGE[rs].label}
              />
            )}
          </div>
          <h2 className="font-display text-lg font-semibold leading-snug text-foreground">
            {f.title}
          </h2>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Server className="h-3.5 w-3.5" />
              {f.affected_asset}
            </span>
            {cvss !== undefined && (
              <span className="font-mono">CVSS {cvss.toFixed(1)}</span>
            )}
          </div>
        </div>
      </div>
      <div className="p-4">
        <FindingEvidence findingId={f._id} finding={f} />
      </div>
    </Card>
  );
}
