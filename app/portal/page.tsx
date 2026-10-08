"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronRight,
  Download,
  FileText,
  ShieldCheck,
  LogOut,
  Loader2,
  Server,
  ListOrdered,
} from "lucide-react";
import { HackerAISVG } from "@/components/icons/hackerai-svg";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBadge, EmptyState, type Tone } from "@/app/admin/_ui";

interface ClientOpt {
  id: string;
  name: string;
}
interface Engagement {
  id: string;
  name: string;
  code: string | null;
  status: string;
  updatedAt: number;
}
interface Report {
  id: string;
  audience: string;
  format: string;
  version: number;
  title: string;
  reportGroupId: string;
  createdAt: number;
}
interface Finding {
  id: string;
  ref: string | null;
  title: string;
  severity: string;
  affectedAsset: string;
  weaknessClass: string;
  cwe: string | null;
  cvssScore: number | null;
  cvssVector: string | null;
  description: string | null;
  impact: string | null;
  remediation: string | null;
  narrative: string | null;
  retestStatus: string | null;
}
interface Evidence {
  id: string;
  sourceType: string;
  label: string | null;
  snippet: string | null;
  stepIndex: number | null;
  toolName: string | null;
  command: string | null;
  resultSummary: string | null;
}

const AUDIENCE: Record<string, string> = {
  technical: "Técnico",
  executive: "Executivo",
  commercial: "Comercial",
  action_plan: "Plano de Ação",
};
const ENG_STATUS: Record<string, string> = {
  planned: "Planejado",
  active: "Ativo",
  review: "Em revisão",
  reporting: "Relatório",
  closed: "Encerrado",
};
const ENG_TONE: Record<string, Tone> = {
  planned: "neutral",
  active: "success",
  review: "warning",
  reporting: "primary",
  closed: "neutral",
};
const SEV_LABEL: Record<string, string> = {
  critical: "Crítico",
  high: "Alto",
  medium: "Médio",
  low: "Baixo",
  info: "Info",
};
const SEV_PILL: Record<string, string> = {
  critical: "text-destructive bg-destructive/10 border-destructive/25",
  high: "text-[#e8590c] bg-[#e8590c]/10 border-[#e8590c]/25",
  medium: "text-warning bg-warning/10 border-warning/25",
  low: "text-primary bg-primary/10 border-primary/25",
  info: "text-muted-foreground bg-muted border-border",
};
const SEV_STRIPE: Record<string, string> = {
  critical: "bg-destructive",
  high: "bg-[#e8590c]",
  medium: "bg-warning",
  low: "bg-primary",
  info: "bg-muted-foreground",
};
const SEV_ORDER = ["critical", "high", "medium", "low", "info"];
const RETEST: Record<string, { label: string; tone: Tone }> = {
  fixed: { label: "Corrigido", tone: "success" },
  still_vulnerable: { label: "Ainda vulnerável", tone: "destructive" },
  pending: { label: "Retest pendente", tone: "warning" },
};

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function PortalPage() {
  const [clients, setClients] = useState<ClientOpt[] | null>(null);
  const [clientId, setClientId] = useState<string | null>(null);
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [openEng, setOpenEng] = useState<string | null>(null);
  const [reportsByEng, setReportsByEng] = useState<Record<string, Report[]>>(
    {},
  );
  const [findingsByEng, setFindingsByEng] = useState<Record<string, Finding[]>>(
    {},
  );
  const [evidenceByFinding, setEvidenceByFinding] = useState<
    Record<string, Evidence[]>
  >({});
  const [openFinding, setOpenFinding] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/portal/clients", { cache: "no-store" });
        if (res.status === 401) {
          window.location.href = "/login";
          return;
        }
        const d = await res.json();
        const list: ClientOpt[] = d.clients ?? [];
        setClients(list);
        if (list.length > 0) setClientId(list[0].id);
      } catch {
        setClients([]);
      }
    })();
  }, []);

  useEffect(() => {
    if (!clientId) return;
    setEngagements([]);
    setOpenEng(null);
    (async () => {
      try {
        const res = await fetch(
          `/api/portal/engagements?clientId=${encodeURIComponent(clientId)}`,
          { cache: "no-store" },
        );
        const d = await res.json();
        setEngagements(d.engagements ?? []);
      } catch {
        setEngagements([]);
      }
    })();
  }, [clientId]);

  const toggleEng = useCallback(
    async (id: string) => {
      if (openEng === id) {
        setOpenEng(null);
        return;
      }
      setOpenEng(id);
      if (!reportsByEng[id]) {
        try {
          const res = await fetch(
            `/api/portal/reports?engagementId=${encodeURIComponent(id)}`,
            { cache: "no-store" },
          );
          const d = await res.json();
          setReportsByEng((m) => ({ ...m, [id]: d.reports ?? [] }));
        } catch {
          setReportsByEng((m) => ({ ...m, [id]: [] }));
        }
      }
      if (!findingsByEng[id]) {
        try {
          const res = await fetch(
            `/api/portal/findings?engagementId=${encodeURIComponent(id)}`,
            { cache: "no-store" },
          );
          const d = await res.json();
          setFindingsByEng((m) => ({ ...m, [id]: d.findings ?? [] }));
        } catch {
          setFindingsByEng((m) => ({ ...m, [id]: [] }));
        }
      }
    },
    [openEng, reportsByEng, findingsByEng],
  );

  const toggleFinding = useCallback(
    async (id: string) => {
      if (openFinding === id) {
        setOpenFinding(null);
        return;
      }
      setOpenFinding(id);
      if (!evidenceByFinding[id]) {
        try {
          const res = await fetch(
            `/api/portal/findings/${encodeURIComponent(id)}/evidence`,
            { cache: "no-store" },
          );
          const d = await res.json();
          setEvidenceByFinding((m) => ({ ...m, [id]: d.evidence ?? [] }));
        } catch {
          setEvidenceByFinding((m) => ({ ...m, [id]: [] }));
        }
      }
    },
    [openFinding, evidenceByFinding],
  );

  const download = useCallback(async (r: Report) => {
    setDownloading(r.id);
    try {
      const res = await fetch(`/api/portal/reports/${r.id}/download`, {
        cache: "no-store",
      });
      if (res.status === 401) {
        toast.error("Sessão expirada — faça login novamente para baixar.");
        window.location.href = "/login";
        return;
      }
      if (!res.ok) {
        toast.error("Não foi possível baixar o relatório.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${AUDIENCE[r.audience] ?? r.audience}_v${r.version}.${r.format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Falha no download.");
    } finally {
      setDownloading(null);
    }
  }, []);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-white/[0.06] bg-gradient-to-r from-[#0f1f38] to-[#0b1626] px-4 py-3 text-[#c7d3e6] md:px-8">
        <HackerAISVG theme="dark" scale={0.12} />
        <span className="hidden text-[13px] text-[#7d8ca8] sm:inline">
          Portal do Cliente
        </span>
        <a
          href="/logout"
          className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-md border border-white/[0.08] bg-white/[0.04] px-3 text-sm font-medium text-[#c7d3e6] transition-colors hover:bg-white/[0.08] hover:text-white"
        >
          <LogOut className="h-4 w-4" /> Sair
        </a>
      </header>

      <main className="mx-auto w-full max-w-4xl px-4 pb-14 pt-6 md:px-8">
        <div className="mb-5 flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[13px] bg-gradient-to-br from-primary/15 to-[#3f6ef0]/[0.08] text-primary shadow-[inset_0_0_0_1px_rgba(36,86,230,0.14)]">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h1 className="font-display text-xl font-bold tracking-tight text-foreground">
              Seus relatórios de segurança
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Achados publicados e relatórios dos seus engajamentos de teste de
              intrusão.
            </p>
          </div>
        </div>

        {clients === null ? (
          <div className="py-16 text-center text-sm text-muted-foreground">
            Carregando…
          </div>
        ) : clients.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title="Nenhum acesso liberado."
            description="Sua conta ainda não tem acesso a nenhum portal. Fale com seu contato de segurança."
          />
        ) : (
          <div className="flex flex-col gap-4">
            {clients.length > 1 && (
              <div className="flex items-center gap-2">
                <label className="text-xs font-medium text-muted-foreground">
                  Cliente
                </label>
                <select
                  value={clientId ?? ""}
                  onChange={(e) => setClientId(e.target.value)}
                  className="h-9 rounded-md border bg-background px-2 text-sm"
                >
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {engagements.length === 0 ? (
              <EmptyState
                icon={FileText}
                title="Nenhum engajamento disponível."
                description="Assim que houver achados publicados ou relatórios, eles aparecem aqui."
              />
            ) : (
              <div className="flex flex-col gap-3">
                {engagements.map((e) => {
                  const open = openEng === e.id;
                  const reports = reportsByEng[e.id];
                  const findings = findingsByEng[e.id];
                  return (
                    <Card key={e.id} className="gap-0 overflow-hidden py-0">
                      <button
                        onClick={() => void toggleEng(e.id)}
                        className="flex w-full items-center gap-3 p-5 text-left transition-colors hover:bg-muted/30"
                      >
                        {open ? (
                          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium">{e.name}</div>
                          <div className="mt-0.5 text-xs text-muted-foreground">
                            {e.code ? `${e.code} · ` : ""}atualizado{" "}
                            {fmtDate(e.updatedAt)}
                          </div>
                        </div>
                        <StatusBadge
                          tone={ENG_TONE[e.status] ?? "neutral"}
                          label={ENG_STATUS[e.status] ?? e.status}
                        />
                      </button>
                      {open && (
                        <div className="space-y-6 border-t p-4 md:p-5">
                          <PortalFindingsSection
                            findings={findings}
                            openFinding={openFinding}
                            evidenceByFinding={evidenceByFinding}
                            onToggleFinding={toggleFinding}
                          />
                          <PortalReportsSection
                            reports={reports}
                            downloading={downloading}
                            onDownload={download}
                          />
                        </div>
                      )}
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function SectionTitle({
  icon: Icon,
  title,
  count,
}: {
  icon: typeof FileText;
  title: string;
  count?: number;
}) {
  return (
    <div className="mb-2.5 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
      <Icon className="h-3.5 w-3.5" />
      {title}
      {count != null && (
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
          {count}
        </span>
      )}
    </div>
  );
}

function PortalFindingsSection({
  findings,
  openFinding,
  evidenceByFinding,
  onToggleFinding,
}: {
  findings: Finding[] | undefined;
  openFinding: string | null;
  evidenceByFinding: Record<string, Evidence[]>;
  onToggleFinding: (id: string) => void;
}) {
  const sevCounts: Record<string, number> = {};
  for (const f of findings ?? []) {
    sevCounts[f.severity] = (sevCounts[f.severity] ?? 0) + 1;
  }
  return (
    <section>
      <SectionTitle
        icon={ShieldCheck}
        title="Achados publicados"
        count={findings?.length}
      />
      {findings === undefined ? (
        <p className="py-2 text-sm text-muted-foreground">Carregando…</p>
      ) : findings.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">
          Nenhum achado publicado ainda.
        </p>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-2">
            {SEV_ORDER.filter((s) => (sevCounts[s] ?? 0) > 0).map((s) => (
              <span
                key={s}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                  SEV_PILL[s],
                )}
              >
                {sevCounts[s]} {SEV_LABEL[s]}
              </span>
            ))}
          </div>
          <div className="space-y-2">
            {findings.map((f) => (
              <PortalFindingItem
                key={f.id}
                finding={f}
                open={openFinding === f.id}
                evidence={evidenceByFinding[f.id]}
                onToggle={() => void onToggleFinding(f.id)}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function PortalFindingItem({
  finding: f,
  open,
  evidence,
  onToggle,
}: {
  finding: Finding;
  open: boolean;
  evidence: Evidence[] | undefined;
  onToggle: () => void;
}) {
  const retest = f.retestStatus ? RETEST[f.retestStatus] : undefined;
  return (
    <div className="relative overflow-hidden rounded-xl border bg-card shadow-[var(--shadow-soft)]">
      <span
        className={cn(
          "absolute inset-y-3 left-0 w-1 rounded-r-full",
          SEV_STRIPE[f.severity] ?? "bg-muted-foreground",
        )}
      />
      <button
        onClick={onToggle}
        className="flex w-full flex-wrap items-center gap-2.5 py-3 pl-5 pr-4 text-left"
      >
        {open ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <span
          className={cn(
            "inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
            SEV_PILL[f.severity] ??
              "border-border bg-muted text-muted-foreground",
          )}
        >
          {SEV_LABEL[f.severity] ?? f.severity}
        </span>
        {f.ref && (
          <span className="shrink-0 font-mono text-[11.5px] text-muted-foreground">
            {f.ref}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate font-medium">{f.title}</span>
        {f.cvssScore != null && (
          <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] font-semibold text-muted-foreground">
            CVSS {f.cvssScore.toFixed(1)}
          </span>
        )}
        {retest && <StatusBadge tone={retest.tone} label={retest.label} />}
      </button>
      {open && (
        <div className="space-y-4 border-t bg-muted/30 p-4">
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Server className="h-3.5 w-3.5" />
              {f.affectedAsset}
            </span>
            {f.cwe && <span className="font-mono">{f.cwe}</span>}
            {f.cvssVector && <span className="font-mono">{f.cvssVector}</span>}
          </div>
          {f.narrative && <PortalBlock label="Narrativa" text={f.narrative} />}
          {f.description && (
            <PortalBlock label="Descrição" text={f.description} />
          )}
          {f.impact && <PortalBlock label="Impacto" text={f.impact} />}
          {f.remediation && (
            <PortalBlock label="Remediação" text={f.remediation} />
          )}
          <PortalEvidence evidence={evidence} />
        </div>
      )}
    </div>
  );
}

function PortalBlock({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-primary">
        {label}
      </div>
      <p className="whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-foreground/80">
        {text}
      </p>
    </div>
  );
}

function PortalEvidence({ evidence }: { evidence: Evidence[] | undefined }) {
  const ordered = (evidence ?? [])
    .slice()
    .sort(
      (a, b) =>
        (a.stepIndex ?? Number.MAX_SAFE_INTEGER) -
        (b.stepIndex ?? Number.MAX_SAFE_INTEGER),
    );
  return (
    <div>
      <SectionTitle
        icon={ListOrdered}
        title="Cadeia de evidência"
        count={evidence?.length ?? 0}
      />
      {evidence === undefined ? (
        <p className="text-xs text-muted-foreground">Carregando…</p>
      ) : ordered.length === 0 ? (
        <p className="text-xs text-muted-foreground">Sem evidência anexada.</p>
      ) : (
        <div className="relative pl-1">
          {ordered.map((ev, i) => (
            <div key={ev.id} className="relative flex gap-3.5 pb-4 last:pb-0">
              {i < ordered.length - 1 && (
                <span className="absolute bottom-0 left-[13px] top-8 w-0.5 bg-border" />
              )}
              <span className="z-[1] flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-primary bg-card text-xs font-bold text-primary shadow-[var(--shadow-soft)]">
                {ev.stepIndex ?? i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  {ev.toolName && (
                    <span className="rounded-md border border-primary/20 bg-primary/10 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-primary">
                      {ev.toolName}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {ev.sourceType}
                    {ev.label ? ` · ${ev.label}` : ""}
                  </span>
                </div>
                {ev.command && (
                  <pre className="overflow-auto rounded-lg bg-[#0e1b2e] px-3 py-2 font-mono text-[11.5px] leading-relaxed text-[#d5e0f2]">
                    <span className="select-none text-[#5f7fb0]">$ </span>
                    {ev.command}
                  </pre>
                )}
                {ev.snippet && (
                  <pre className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg border bg-card px-3 py-2 font-mono text-[11px] text-muted-foreground">
                    {ev.snippet}
                  </pre>
                )}
                {ev.resultSummary && (
                  <div className="mt-1.5 flex gap-1.5 text-xs">
                    <span className="font-semibold text-success">→ prova:</span>
                    <span className="text-foreground/80">
                      {ev.resultSummary}
                    </span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PortalReportsSection({
  reports,
  downloading,
  onDownload,
}: {
  reports: Report[] | undefined;
  downloading: string | null;
  onDownload: (r: Report) => void;
}) {
  return (
    <section>
      <SectionTitle
        icon={FileText}
        title="Relatórios"
        count={reports?.length}
      />
      {reports === undefined ? (
        <p className="py-2 text-sm text-muted-foreground">Carregando…</p>
      ) : reports.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">
          Nenhum relatório disponível ainda.
        </p>
      ) : (
        <div className="space-y-2">
          {reports.map((r) => (
            <div
              key={r.id}
              className="flex items-center gap-3 rounded-lg border bg-card px-4 py-2.5 shadow-[var(--shadow-soft)]"
            >
              <FileText className="h-4 w-4 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  {AUDIENCE[r.audience] ?? r.audience} · v{r.version}
                </div>
                <div className="text-xs uppercase text-muted-foreground">
                  {r.format} · {fmtDate(r.createdAt)}
                </div>
              </div>
              <Button
                size="sm"
                onClick={() => void onDownload(r)}
                disabled={downloading === r.id}
              >
                {downloading === r.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                {downloading === r.id ? "Baixando…" : "Baixar"}
              </Button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
