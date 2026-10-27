"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import {
  Search,
  ShieldAlert,
  Sparkles,
  RefreshCw,
  Server,
  Image as ImageIcon,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { AppShell } from "@/components/internal/app-shell";
import {
  SectionHeader,
  StatCard,
  StatusBadge,
  EmptyState,
  formatDateTime,
} from "@/app/admin/_ui";
import {
  FindingActions,
  FindingOverviewBody,
  FindingTraceBody,
  FindingFixBody,
  SEV_LABEL,
  SEV_PILL,
  SEV_STRIPE,
  STATUS_LABEL,
  STATUS_TONE,
  RETEST_BADGE,
  type Severity,
  type FindingStatus,
} from "@/components/internal/findings";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Seção Achados: tabela de issues (colunas + chips de filtro + busca, tudo
 * client-side) + detalhe em slide-over com abas Visão geral / Trace / Correção.
 * Escopada por engajamento; deep-link via ?e=&f= (o board de Engajamentos abre
 * um achado direto; a URL e o slide-over ficam em sincronia).
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

// Chips de filtro (client-side, sobre os achados já carregados do engajamento).
const CHIP_DEFS: {
  key: string;
  label: string;
  dot?: string;
  test: (f: Doc<"findings">) => boolean;
}[] = [
  { key: "all", label: "Todos", test: () => true },
  {
    key: "critical",
    label: "Críticos",
    dot: "bg-destructive",
    test: (f) => f.severity === "critical",
  },
  {
    key: "high",
    label: "Alto",
    dot: "bg-sev-high",
    test: (f) => f.severity === "high",
  },
  {
    key: "in_review",
    label: "Em revisão",
    dot: "bg-warning",
    test: (f) => f.status === "in_review",
  },
  {
    key: "new7",
    label: "Novos",
    dot: "bg-primary",
    test: (f) => Date.now() - f.created_at < SEVEN_DAYS_MS,
  },
  {
    key: "retest",
    label: "Retest pendente",
    dot: "bg-warning",
    test: (f) => f.retest_status === "pending",
  },
];

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
  // Quantos screenshots cada achado tem (chip "📷 N" na lista).
  const imageCounts =
    useQuery(api.findings.getEngagementImageEvidenceCounts, {
      engagementId,
    }) ?? {};

  const [chip, setChip] = useState("all");
  const [q, setQ] = useState("");

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

  // Contagem de cada chip vem do array NÃO filtrado (senão o número muda ao
  // filtrar). Linhas vêm do filtrado.
  const chipCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const def of CHIP_DEFS) m[def.key] = 0;
    for (const f of findings ?? [])
      for (const def of CHIP_DEFS) if (def.test(f)) m[def.key] += 1;
    return m;
  }, [findings]);

  const filtered = useMemo(() => {
    const list = findings ?? [];
    const def = CHIP_DEFS.find((c) => c.key === chip) ?? CHIP_DEFS[0];
    const needle = q.trim().toLowerCase();
    return list.filter((f) => {
      if (!def.test(f)) return false;
      if (needle) {
        const hay =
          `${f.title} ${f.affected_asset} ${f.finding_id ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [findings, chip, q]);

  const openFinding = useMemo(
    () => (findings ?? []).find((f) => f._id === openFindingId) ?? null,
    [findings, openFindingId],
  );

  // Deep-link obsoleto: ?f= aponta p/ achado que não existe mais neste
  // engajamento (removido/movido/descartado-e-filtrado) → limpa para a URL e o
  // slide-over concordarem, em vez de ficar um ?f= pendurado sem efeito.
  useEffect(() => {
    if (findings !== undefined && openFindingId && !openFinding) {
      setOpenFindingId(null);
    }
  }, [findings, openFindingId, openFinding, setOpenFindingId]);

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
        {/* Busca + chips de filtro */}
        <div className="flex flex-col gap-3 border-b p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar por título, asset ou ID do achado"
              className="pl-9"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {CHIP_DEFS.map((def) => (
              <button
                key={def.key}
                onClick={() => setChip(def.key)}
                aria-pressed={chip === def.key}
                className={cn(
                  "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
                  chip === def.key
                    ? "border-primary/45 bg-primary/15 text-foreground"
                    : "border-border bg-card text-muted-foreground hover:border-ring",
                )}
              >
                {def.dot && (
                  <span className={cn("h-1.5 w-1.5 rounded-full", def.dot)} />
                )}
                {def.label}
                <span className="rounded-full bg-muted px-1.5 text-[11px] tabular-nums text-muted-foreground">
                  {chipCounts[def.key] ?? 0}
                </span>
              </button>
            ))}
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
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Search}
            title="Nenhum achado para este filtro."
            description="Ajuste a busca ou os chips de filtro acima."
          />
        ) : (
          <FindingsTable
            findings={filtered}
            imageCounts={imageCounts}
            onOpen={setOpenFindingId}
          />
        )}
      </Card>

      <FindingSheet
        finding={openFinding}
        onClose={() => setOpenFindingId(null)}
      />
    </>
  );
}

function FindingsTable({
  findings,
  imageCounts,
  onOpen,
}: {
  findings: Doc<"findings">[];
  imageCounts: Record<string, number>;
  onOpen: (id: Id<"findings">) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] border-collapse">
        <thead>
          <tr className="border-b bg-muted/40">
            {["Issue", "Severidade", "Asset", "Categoria", "Descoberto", "Status"].map(
              (h) => (
                <th
                  key={h}
                  className="whitespace-nowrap px-3.5 py-3 text-left text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground"
                >
                  {h}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {findings.map((f) => (
            <FindingTableRow
              key={f._id}
              finding={f}
              imageCount={imageCounts[f._id] ?? 0}
              onOpen={() => onOpen(f._id)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FindingTableRow({
  finding: f,
  imageCount,
  onOpen,
}: {
  finding: Doc<"findings">;
  imageCount?: number;
  onOpen: () => void;
}) {
  const severity = f.severity as Severity;
  const status = f.status as FindingStatus;
  const cvss = typeof f.cvss_score === "number" ? f.cvss_score : undefined;
  const rs = f.retest_status;
  return (
    <tr
      onClick={onOpen}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className="cursor-pointer border-b border-border/70 outline-none transition-colors last:border-0 hover:bg-primary/[0.06] focus-visible:bg-primary/[0.08]"
    >
      <td className="px-3.5 py-3">
        <div className="flex items-start gap-3">
          <span
            className={cn(
              "w-1 shrink-0 self-stretch rounded-full",
              SEV_STRIPE[severity],
            )}
            style={{ minHeight: "2rem" }}
          />
          <div className="min-w-0">
            {/* Nome COMPLETO do achado — nunca truncado (clareza). */}
            <div className="font-medium leading-snug text-foreground">
              {f.title}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-muted-foreground">
              {f.finding_id && (
                <span className="font-mono text-[10.5px]">{f.finding_id}</span>
              )}
              {cvss !== undefined && (
                <span className="tabular-nums">CVSS {cvss.toFixed(1)}</span>
              )}
              {imageCount ? (
                <span
                  title={`${imageCount} screenshot${imageCount > 1 ? "s" : ""}`}
                  className="inline-flex items-center gap-1"
                >
                  <ImageIcon className="h-3 w-3" />
                  {imageCount}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </td>
      <td className="px-3.5 py-3">
        <span
          className={cn(
            "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
            SEV_PILL[severity],
          )}
        >
          {SEV_LABEL[severity]}
        </span>
      </td>
      <td className="px-3.5 py-3">
        <span className="inline-flex items-center gap-1.5 text-[13px] text-foreground/85">
          <Server className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="break-all">{f.affected_asset}</span>
        </span>
      </td>
      <td className="px-3.5 py-3 text-[13px] text-foreground/80">
        {f.weakness_class}
      </td>
      <td className="whitespace-nowrap px-3.5 py-3 text-[13px] tabular-nums text-muted-foreground">
        {formatDateTime(f.created_at)}
      </td>
      <td className="px-3.5 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={STATUS_TONE[status]} label={STATUS_LABEL[status]} />
          {rs && RETEST_BADGE[rs] && (
            <StatusBadge
              tone={RETEST_BADGE[rs].tone}
              label={RETEST_BADGE[rs].label}
            />
          )}
        </div>
      </td>
    </tr>
  );
}

function FindingSheet({
  finding,
  onClose,
}: {
  finding: Doc<"findings"> | null;
  onClose: () => void;
}) {
  // Enquanto aberto, usa o achado AO VIVO (status/retest refletem mutações); ao
  // fechar (finding→null), segura o último p/ a animação de saída não piscar
  // vazio. Padrão "ajustar estado em render" do React (sem effect, sem ref).
  const [lastShown, setLastShown] = useState<Doc<"findings"> | null>(finding);
  if (finding && finding !== lastShown) setLastShown(finding);
  const shown = finding ?? lastShown;

  return (
    <Sheet
      open={!!finding}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-xl md:max-w-2xl"
      >
        {/* key={_id}: trocar de achado remonta → a aba volta p/ "Visão geral" e
            o estado das imagens reseta, sem effect de reset. */}
        {shown ? <FindingSheetInner key={shown._id} finding={shown} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function FindingSheetInner({ finding }: { finding: Doc<"findings"> }) {
  // key={_id} no pai remonta ao trocar de achado → a aba inicia em "overview".
  const [tab, setTab] = useState<"overview" | "trace" | "fix">("overview");

  const severity = finding.severity as Severity;
  const status = finding.status as FindingStatus;
  const rs = finding.retest_status;
  const cvss =
    typeof finding.cvss_score === "number" ? finding.cvss_score : undefined;
  const hasFix = !!finding.remediation || !!finding.cwe;
  const hasSteps = (finding.reproduction_steps?.length ?? 0) > 0;

  const TABS: {
    key: "overview" | "trace" | "fix";
    label: string;
    dot?: boolean;
  }[] = [
    { key: "overview", label: "Visão geral" },
    { key: "trace", label: "Trace", dot: hasSteps },
    { key: "fix", label: "Correção", dot: hasFix },
  ];

  return (
    <>
      <SheetHeader className="shrink-0 gap-0 space-y-0 border-b p-0">
        <div className="flex items-start gap-3 px-5 pt-5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <ShieldAlert className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1 pr-6">
            {/* Título COMPLETO do achado — quebra em linha, sem truncar. */}
            <SheetTitle className="font-display text-lg font-semibold leading-snug text-foreground">
              {finding.title}
            </SheetTitle>
            <SheetDescription className="mt-1 text-xs text-muted-foreground">
              {finding.weakness_class}
            </SheetDescription>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 px-5 pb-3 pt-3">
          {finding.finding_id && (
            <span className="font-mono text-xs text-muted-foreground">
              {finding.finding_id}
            </span>
          )}
          <span
            className={cn(
              "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
              SEV_PILL[severity],
            )}
          >
            {SEV_LABEL[severity]}
          </span>
          <StatusBadge tone={STATUS_TONE[status]} label={STATUS_LABEL[status]} />
          {rs && RETEST_BADGE[rs] && (
            <StatusBadge
              tone={RETEST_BADGE[rs].tone}
              label={RETEST_BADGE[rs].label}
            />
          )}
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Server className="h-3.5 w-3.5" />
            <span className="break-all">{finding.affected_asset}</span>
          </span>
          {cvss !== undefined && (
            <span className="font-mono text-xs text-muted-foreground">
              CVSS {cvss.toFixed(1)}
            </span>
          )}
        </div>
        <div
          role="tablist"
          aria-label="Detalhe do achado"
          className="flex gap-1 px-4"
        >
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-semibold transition-colors",
                tab === t.key
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
              {t.dot && (
                <span className="h-1.5 w-1.5 rounded-full bg-primary/70" />
              )}
            </button>
          ))}
        </div>
      </SheetHeader>

      {/* Painéis: TODOS montados (toggle por hidden) → o estado de
          disponibilidade das imagens (imgState) não se perde ao trocar de aba. */}
      <div className="min-h-0 flex-1 overflow-auto px-5 py-5">
        <div hidden={tab !== "overview"}>
          <FindingOverviewBody finding={finding} />
        </div>
        <div hidden={tab !== "trace"}>
          <FindingTraceBody findingId={finding._id} finding={finding} />
        </div>
        <div hidden={tab !== "fix"}>
          <FindingFixBody finding={finding} />
        </div>
      </div>

      <div className="shrink-0 border-t px-5 py-3">
        <FindingActions findingId={finding._id} status={status} />
      </div>
    </>
  );
}
