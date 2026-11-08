"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  ChevronRight,
  Download,
  FileText,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  Loader2,
  LogOut,
  Server,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { SuricatoosAISVG } from "@/components/icons/suricatoos-ai-svg";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Callout,
  EmptyState,
  PanelSkeleton,
  SectionHeader,
  StatCard,
  StatusBadge,
  TabBar,
  formatDateTime,
  sortRows,
  SortableTh,
  useSortable,
  type TabItem,
} from "@/app/admin/_ui";
import {
  SEV_LABEL,
  SEV_ORDER,
  SEV_STRIPE,
  RETEST_BADGE,
  asSeverity,
  type Severity,
} from "@/components/internal/severity";
import { SeverityBadge } from "@/components/internal/finding-badges";
import {
  engagementStatusLabel,
  engagementStatusTone,
} from "@/components/internal/engagement-status";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { parseContentDispositionFilename } from "@/lib/reports/report-filename";
import { MfaEnrollmentWidget } from "@/components/mfa/MfaEnrollmentWidget";
import { EvidenceDownloadButton } from "@/components/mfa/EvidenceDownloadButton";
import { ThemeToggle } from "@/components/internal/ThemeToggle";

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
const FORMAT_LABEL: Record<string, string> = {
  docx: "Word",
  pptx: "PowerPoint",
  pdf: "PDF",
  json: "JSON",
};
function formatLabel(f: string): string {
  return FORMAT_LABEL[f.toLowerCase()] ?? f.toUpperCase();
}
const SOURCE_TYPE_LABEL: Record<string, string> = {
  note: "Nota do analista",
  command: "Comando",
  tool_output: "Saída de ferramenta",
  file: "Arquivo",
  http: "Requisição HTTP",
  manual: "Registro manual",
};
function sourceTypeLabel(s: string): string {
  return SOURCE_TYPE_LABEL[s.toLowerCase()] ?? s;
}

const SEV_RANK: Record<Severity, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
};

/** Um achado "em aberto" = publicado e NÃO validado como corrigido por reteste.
 *  (still_vulnerable / pending / sem reteste contam como em aberto.) */
function isOpen(f: Finding): boolean {
  return f.retestStatus !== "fixed";
}

/** Versão do CVSS lida do prefixo do vetor ("CVSS:3.1/..." → "3.1"). Fase 0 não
 *  tem o campo cvss_version; a versão é o que o cliente cita. */
function cvssVersionFromVector(vector: string | null): string | null {
  if (!vector) return null;
  const m = vector.match(/^CVSS:(\d+\.\d+)\//);
  return m ? m[1] : null;
}
function cvssText(f: Finding): string | null {
  if (f.cvssScore == null) return null;
  const v = cvssVersionFromVector(f.cvssVector);
  return `CVSS ${v ? `${v} · ` : ""}${f.cvssScore.toFixed(1)}`;
}

/** 401 numa ação deliberada do usuário: avisa e manda ao login. */
function redirectToLogin() {
  toast.error("Sessão expirada — faça login novamente.");
  window.location.href = "/login";
}

export default function PortalPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // ── Estado na URL (?c=/?e=/?tab=/?f=), no padrão do operador (/achados). ──
  const clientParam = searchParams.get("c");
  const engagementId = searchParams.get("e");
  const tab = searchParams.get("tab") ?? "visao";
  const findingId = searchParams.get("f");

  const setParams = useCallback(
    (updates: Record<string, string | null>, replace = false) => {
      const p = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(updates)) {
        if (v == null) p.delete(k);
        else p.set(k, v);
      }
      const qs = p.toString();
      const url = qs ? `/portal?${qs}` : "/portal";
      if (replace) router.replace(url);
      else router.push(url);
    },
    [router, searchParams],
  );

  // ── Dados (fetch mantém o tratamento de erro TIER-1: erro ≠ vazio). ──
  const [clients, setClients] = useState<ClientOpt[] | null>(null);
  const [clientsErr, setClientsErr] = useState(false);
  const [engagements, setEngagements] = useState<Engagement[] | null>(null);
  const [engagementsErr, setEngagementsErr] = useState(false);
  const [reportsByEng, setReportsByEng] = useState<Record<string, Report[]>>(
    {},
  );
  const [reportsErr, setReportsErr] = useState<Record<string, boolean>>({});
  const [findingsByEng, setFindingsByEng] = useState<Record<string, Finding[]>>(
    {},
  );
  const [findingsErr, setFindingsErr] = useState<Record<string, boolean>>({});
  const [evidenceByFinding, setEvidenceByFinding] = useState<
    Record<string, Evidence[]>
  >({});
  const [evidenceErr, setEvidenceErr] = useState<Record<string, boolean>>({});
  const [downloading, setDownloading] = useState<string | null>(null);
  const [securityOpen, setSecurityOpen] = useState(false);

  const clientId = clientParam ?? clients?.[0]?.id ?? null;

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/portal/clients", { cache: "no-store" });
        if (res.status === 401) {
          window.location.href = "/login";
          return;
        }
        if (!res.ok) throw new Error(`clients ${res.status}`);
        const d = await res.json();
        setClients(d.clients ?? []);
      } catch {
        // Erro ≠ "sem acesso": sai de "carregando" e o render mostra o aviso.
        setClientsErr(true);
        setClients([]);
      }
    })();
  }, []);

  useEffect(() => {
    if (!clientId) return;
    setEngagements(null);
    setEngagementsErr(false);
    (async () => {
      try {
        const res = await fetch(
          `/api/portal/engagements?clientId=${encodeURIComponent(clientId)}`,
          { cache: "no-store" },
        );
        if (res.status === 401) {
          window.location.href = "/login";
          return;
        }
        if (!res.ok) throw new Error(`engagements ${res.status}`);
        const d = await res.json();
        setEngagements(d.engagements ?? []);
      } catch {
        setEngagementsErr(true);
        setEngagements([]);
      }
    })();
  }, [clientId]);

  // Carrega relatórios + achados do engajamento selecionado (?e=).
  useEffect(() => {
    if (!engagementId) return;
    const id = engagementId;
    if (!reportsByEng[id]) {
      setReportsErr((m) => ({ ...m, [id]: false }));
      (async () => {
        try {
          const res = await fetch(
            `/api/portal/reports?engagementId=${encodeURIComponent(id)}`,
            { cache: "no-store" },
          );
          if (res.status === 401) return redirectToLogin();
          if (!res.ok) throw new Error(`reports ${res.status}`);
          const d = await res.json();
          setReportsByEng((m) => ({ ...m, [id]: d.reports ?? [] }));
        } catch {
          // NÃO grava [] (o guard !reportsByEng[id] permite nova tentativa).
          setReportsErr((m) => ({ ...m, [id]: true }));
        }
      })();
    }
    if (!findingsByEng[id]) {
      setFindingsErr((m) => ({ ...m, [id]: false }));
      (async () => {
        try {
          const res = await fetch(
            `/api/portal/findings?engagementId=${encodeURIComponent(id)}`,
            { cache: "no-store" },
          );
          if (res.status === 401) return redirectToLogin();
          if (!res.ok) throw new Error(`findings ${res.status}`);
          const d = await res.json();
          setFindingsByEng((m) => ({ ...m, [id]: d.findings ?? [] }));
        } catch {
          setFindingsErr((m) => ({ ...m, [id]: true }));
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engagementId]);

  const selectedEng = useMemo(
    () => engagements?.find((e) => e.id === engagementId) ?? null,
    [engagements, engagementId],
  );

  // ?e= inválido (engajamento inexistente após carregar) → volta ao portfólio.
  // MAS não em ERRO de carga (engagements=[] no catch) — aí o ?e= deve
  // sobreviver (como o padrão de findings); senão o erro apaga o deep-link.
  useEffect(() => {
    if (engagements && engagementId && !selectedEng && !engagementsErr) {
      setParams({ e: null, tab: null, f: null }, true);
    }
  }, [engagements, engagementId, selectedEng, engagementsErr, setParams]);

  const findings = engagementId ? findingsByEng[engagementId] : undefined;
  const reports = engagementId ? reportsByEng[engagementId] : undefined;
  const openFinding = useMemo(
    () => findings?.find((f) => f.id === findingId) ?? null,
    [findings, findingId],
  );

  // ?f= obsoleto (achado não está no engajamento carregado) → limpa (replace).
  useEffect(() => {
    if (findings && findingId && !openFinding) {
      setParams({ f: null }, true);
    }
  }, [findings, findingId, openFinding, setParams]);

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
      const fromHeader = parseContentDispositionFilename(
        res.headers.get("content-disposition"),
      );
      if (!fromHeader) {
        console.warn(
          "[portal download] Content-Disposition sem filename; usando fallback",
        );
      }
      a.download =
        fromHeader ??
        `${AUDIENCE[r.audience] ?? r.audience}_v${r.version}.${r.format}`;
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

  const railBtn =
    "inline-flex h-9 items-center gap-1.5 rounded-md border border-white/[0.08] bg-white/[0.04] px-3 text-sm font-medium text-chrome-fg transition-colors hover:bg-white/[0.08] hover:text-chrome-active-fg";

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-white/[0.06] bg-gradient-to-r from-chrome to-chrome-2 px-4 py-3 text-chrome-fg md:px-8">
        <SuricatoosAISVG theme="dark" scale={0.12} />
        <span className="hidden text-[13px] text-chrome-fg-dim sm:inline">
          Portal do Cliente
        </span>
        <div className="ml-auto flex items-center gap-2">
          {clients && clients.length > 1 && (
            <select
              value={clientId ?? ""}
              onChange={(e) =>
                setParams({ c: e.target.value, e: null, tab: null, f: null })
              }
              aria-label="Cliente"
              className="h-9 rounded-md border border-white/[0.1] bg-chrome-2 px-2 text-sm text-chrome-fg outline-none focus-visible:ring-2 focus-visible:ring-chrome-accent/60"
            >
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          <ThemeToggle className="text-chrome-fg hover:bg-white/[0.08] hover:text-chrome-active-fg" />
          <button
            type="button"
            onClick={() => setSecurityOpen(true)}
            className={railBtn}
          >
            <KeyRound className="h-4 w-4" /> Segurança
          </button>
          <a href="/logout" className={railBtn}>
            <LogOut className="h-4 w-4" /> Sair
          </a>
        </div>
      </header>

      <Dialog open={securityOpen} onOpenChange={setSecurityOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Segurança da conta</DialogTitle>
            <DialogDescription>
              Gerencie sua senha, autenticação multifator (MFA/TOTP) e sessões.
              O MFA será exigido para baixar o pacote de evidências.
            </DialogDescription>
          </DialogHeader>
          <MfaEnrollmentWidget />
        </DialogContent>
      </Dialog>

      <main className="mx-auto w-full max-w-5xl px-4 pb-14 pt-6 md:px-8">
        {clients === null ? (
          <PanelSkeleton rows={4} />
        ) : clientsErr ? (
          <Callout tone="destructive" icon={AlertTriangle}>
            Não foi possível carregar seus acessos — o serviço está indisponível
            no momento, não é ausência de acesso. Atualize a página em
            instantes.
          </Callout>
        ) : clients.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title="Nenhum acesso liberado."
            description="Sua conta ainda não tem acesso a nenhum portal. Fale com seu contato de segurança."
          />
        ) : selectedEng ? (
          <EngagementView
            engagement={selectedEng}
            tab={tab}
            findings={findings}
            findingsError={findingsErr[engagementId ?? ""]}
            reports={reports}
            reportsError={reportsErr[engagementId ?? ""]}
            downloading={downloading}
            onDownload={download}
            onTab={(t) => setParams({ tab: t, f: null })}
            onBack={() => setParams({ e: null, tab: null, f: null })}
            onOpenFinding={(fid) => setParams({ f: fid })}
          />
        ) : (
          <PortfolioView
            engagements={engagements}
            error={engagementsErr}
            onOpen={(id) => setParams({ e: id, tab: null, f: null })}
          />
        )}
      </main>

      <FindingSheet
        finding={openFinding}
        engagementName={selectedEng?.name ?? ""}
        evidence={openFinding ? evidenceByFinding[openFinding.id] : undefined}
        evidenceError={openFinding ? evidenceErr[openFinding.id] : undefined}
        onClose={() => setParams({ f: null }, true)}
        onNeedEvidence={(fid) => {
          if (evidenceByFinding[fid]) return;
          setEvidenceErr((m) => ({ ...m, [fid]: false }));
          (async () => {
            try {
              const res = await fetch(
                `/api/portal/findings/${encodeURIComponent(fid)}/evidence`,
                { cache: "no-store" },
              );
              if (res.status === 401) return redirectToLogin();
              if (!res.ok) throw new Error(`evidence ${res.status}`);
              const d = await res.json();
              setEvidenceByFinding((m) => ({ ...m, [fid]: d.evidence ?? [] }));
            } catch {
              setEvidenceErr((m) => ({ ...m, [fid]: true }));
            }
          })();
        }}
      />
    </div>
  );
}

// Rótulos de status CLIENT-FACING (portal) — sobrepõem o LABEL do módulo
// compartilhado; o TOM continua vindo de engagementStatusTone. Mantém o
// operador e engagement-status.ts intactos (só o texto ao cliente muda aqui).
const PORTAL_STATUS_LABEL: Record<string, string> = {
  active: "Em andamento",
  reporting: "Relatório em elaboração",
  closed: "Encerrado",
};
function portalStatusLabel(status: string): string {
  return PORTAL_STATUS_LABEL[status] ?? engagementStatusLabel(status);
}

// ── TELA A — Portfólio (lista de engajamentos). Sem números agregados na Fase
//    0 (o agregado de portfólio é Fase 1; somar via N+1 de /findings polui a
//    auditoria). ───────────────────────────────────────────────────────────
function PortfolioView({
  engagements,
  error,
  onOpen,
}: {
  engagements: Engagement[] | null;
  error: boolean;
  onOpen: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-display text-xl font-bold tracking-tight text-foreground">
          Seus testes de segurança
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Achados publicados, correções validadas por reteste e relatórios de
          cada engajamento.
        </p>
      </div>

      {error ? (
        <Callout tone="destructive" icon={AlertTriangle}>
          Não foi possível carregar seus engajamentos — serviço indisponível,
          não vazio. Atualize a página em instantes.
        </Callout>
      ) : engagements === null ? (
        <PanelSkeleton rows={4} />
      ) : engagements.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="Nenhum engajamento disponível."
          description="Assim que houver achados publicados ou relatórios, eles aparecem aqui."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {engagements.map((e) => (
            <button
              key={e.id}
              onClick={() => onOpen(e.id)}
              className="group text-left"
            >
              <Card className="gap-0 py-0 transition-colors group-hover:border-ring">
                <div className="flex items-start gap-3 p-5">
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <ShieldCheck className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold text-foreground">
                      {e.name}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      {e.code && <span className="font-mono">{e.code}</span>}
                      <span>Atualizado {formatDateTime(e.updatedAt)}</span>
                    </div>
                  </div>
                  <StatusBadge
                    tone={engagementStatusTone(e.status)}
                    label={portalStatusLabel(e.status)}
                  />
                  <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </div>
              </Card>
            </button>
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        As contagens consideram apenas achados publicados. Ausência de achados
        publicados não atesta ausência de risco.
      </p>
    </div>
  );
}

// ── TELA B — Engajamento (hero por engajamento + abas). ────────────────────
type EngTab = "visao" | "achados" | "relatorios" | "evidencia";

function EngagementView({
  engagement,
  tab,
  findings,
  findingsError,
  reports,
  reportsError,
  downloading,
  onDownload,
  onTab,
  onBack,
  onOpenFinding,
}: {
  engagement: Engagement;
  tab: string;
  findings: Finding[] | undefined;
  findingsError?: boolean;
  reports: Report[] | undefined;
  reportsError?: boolean;
  downloading: string | null;
  onDownload: (r: Report) => void;
  onTab: (t: EngTab) => void;
  onBack: () => void;
  onOpenFinding: (id: string) => void;
}) {
  const published = findings?.length ?? 0;
  const openCount = (findings ?? []).filter(isOpen).length;
  const active: EngTab = (
    ["visao", "achados", "relatorios", "evidencia"] as const
  ).includes(tab as EngTab)
    ? (tab as EngTab)
    : "visao";

  const tabs: TabItem<EngTab>[] = [
    { id: "visao", label: "Visão geral", icon: LayoutDashboard },
    {
      id: "achados",
      label: "Achados",
      icon: ShieldAlert,
      badge: findings?.length,
    },
    {
      id: "relatorios",
      label: "Relatórios",
      icon: FileText,
      badge: reports?.length,
    },
    { id: "evidencia", label: "Pacote de evidências", icon: ListChecks },
  ];

  return (
    <div className="flex flex-col gap-5">
      <button
        onClick={onBack}
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Todos os engajamentos
      </button>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-xl font-bold tracking-tight text-foreground">
              {engagement.name}
            </h1>
            <StatusBadge
              tone={engagementStatusTone(engagement.status)}
              label={portalStatusLabel(engagement.status)}
            />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            {engagement.code && (
              <span className="font-mono">{engagement.code}</span>
            )}
            <span>Atualizado {formatDateTime(engagement.updatedAt)}</span>
          </div>
        </div>
      </div>

      <TabBar<EngTab> tabs={tabs} active={active} onChange={onTab} />

      {active === "visao" && (
        <OverviewTab
          findings={findings}
          error={findingsError}
          onOpenFinding={onOpenFinding}
        />
      )}
      {active === "achados" && (
        <FindingsTab
          findings={findings}
          error={findingsError}
          onOpenFinding={onOpenFinding}
        />
      )}
      {active === "relatorios" && (
        <ReportsTab
          reports={reports}
          error={reportsError}
          downloading={downloading}
          onDownload={onDownload}
        />
      )}
      {active === "evidencia" && (
        <div className="flex flex-col gap-3">
          <SectionHeader
            icon={ListChecks}
            title="Pacote de evidências"
            description="Arquivo .tar.gz com todas as capturas deste engajamento. A cadeia de cada achado também está no detalhe do achado (aba Achados)."
          />
          <Card className="py-0">
            <div className="flex flex-wrap items-center justify-between gap-3 p-5">
              <div className="min-w-0 text-sm text-muted-foreground">
                O download exige verificação de MFA (TOTP).
              </div>
              <EvidenceDownloadButton
                engagementId={engagement.id}
                apiBase="/api/portal/evidence-bundle"
                enrollContent={<MfaEnrollmentWidget />}
              />
            </div>
          </Card>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        &quot;Em aberto&quot; = achado publicado ainda não validado como
        corrigido por reteste. As contagens consideram apenas achados
        publicados.
      </p>
      {active === "visao" && openCount === 0 && published > 0 && (
        <p className="text-xs text-muted-foreground">
          Nenhum achado em aberto neste engajamento.
        </p>
      )}
    </div>
  );
}

function computeSummary(findings: Finding[]) {
  const open = findings.filter(isOpen);
  const sevCounts = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  } as Record<Severity, number>;
  for (const f of open) sevCounts[asSeverity(f.severity)] += 1;
  const worstOpen = SEV_ORDER.find((s) => sevCounts[s] > 0) ?? null;
  const retest = {
    fixed: 0,
    still_vulnerable: 0,
    pending: 0,
    none: 0,
  };
  for (const f of findings) {
    if (f.retestStatus === "fixed") retest.fixed += 1;
    else if (f.retestStatus === "still_vulnerable")
      retest.still_vulnerable += 1;
    else if (f.retestStatus === "pending") retest.pending += 1;
    else retest.none += 1;
  }
  const priorities = open
    .slice()
    .sort((a, b) => {
      const ra =
        SEV_RANK[asSeverity(b.severity)] - SEV_RANK[asSeverity(a.severity)];
      if (ra !== 0) return ra;
      return (b.cvssScore ?? -1) - (a.cvssScore ?? -1);
    })
    .slice(0, 5);
  return { open, sevCounts, worstOpen, retest, priorities };
}

function OverviewTab({
  findings,
  error,
  onOpenFinding,
}: {
  findings: Finding[] | undefined;
  error?: boolean;
  onOpenFinding: (id: string) => void;
}) {
  if (error)
    return (
      <Callout tone="destructive" icon={AlertTriangle}>
        Não foi possível carregar os achados — serviço indisponível, não
        significa que nada foi encontrado. Atualize a página em instantes.
      </Callout>
    );
  if (findings === undefined) return <PanelSkeleton rows={4} />;
  if (findings.length === 0)
    return (
      <EmptyState
        icon={ShieldCheck}
        title="Nenhum achado publicado ainda."
        description="Assim que houver achados publicados neste engajamento, o resumo aparece aqui."
      />
    );

  const s = computeSummary(findings);
  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-4 lg:grid-cols-12">
        <Card className="py-0 lg:col-span-7">
          <div className="flex flex-col gap-3 p-5">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Pior severidade em aberto
            </span>
            {s.worstOpen ? (
              <>
                <div>
                  <SeverityBadge severity={s.worstOpen} hint />
                </div>
                <p className="text-sm text-foreground/80">
                  {s.sevCounts.critical > 0 || s.sevCounts.high > 0
                    ? `${s.sevCounts.critical} crítico(s) e ${s.sevCounts.high} alto(s) sem correção validada por reteste.`
                    : "Nenhum achado crítico ou alto em aberto no momento."}
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Nenhum achado em aberto. Os achados publicados foram validados
                como corrigidos por reteste.
              </p>
            )}
            <div className="text-xs text-muted-foreground">
              {s.open.length} em aberto · {s.retest.fixed} validado(s) por
              reteste
            </div>
          </div>
        </Card>
        <Card className="py-0 lg:col-span-5">
          <div className="flex flex-col gap-3 p-5">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Em aberto por severidade
            </span>
            <SeverityStrip counts={s.sevCounts} />
          </div>
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Publicados"
          value={String(findings.length)}
          sub={`${s.open.length} em aberto`}
          icon={ShieldAlert}
          tone="primary"
        />
        <StatCard
          label="Em aberto"
          value={String(s.open.length)}
          sub="não validados por reteste"
          icon={ShieldAlert}
          tone={s.open.length > 0 ? "warning" : "neutral"}
        />
        <StatCard
          label="Validados por reteste"
          value={String(s.retest.fixed)}
          sub={`de ${findings.length}`}
          icon={ShieldCheck}
          tone={s.retest.fixed > 0 ? "success" : "neutral"}
        />
        <StatCard
          label="Ainda vulneráveis"
          value={String(s.retest.still_vulnerable)}
          sub="confirmados no reteste"
          icon={ShieldAlert}
          tone={s.retest.still_vulnerable > 0 ? "destructive" : "neutral"}
        />
      </div>

      {s.priorities.length > 0 && (
        <div className="flex flex-col gap-2.5">
          <SectionHeader
            icon={ShieldAlert}
            title="Prioridades de correção"
            description={
              s.open.length > s.priorities.length
                ? `As ${s.priorities.length} de maior severidade, de ${s.open.length} em aberto.`
                : undefined
            }
          />
          <div className="flex flex-col gap-2">
            {s.priorities.map((f) => (
              <PriorityRow key={f.id} finding={f} onOpen={onOpenFinding} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SeverityStrip({ counts }: { counts: Record<Severity, number> }) {
  const total = SEV_ORDER.reduce((a, s) => a + (counts[s] ?? 0), 0);
  return (
    <div>
      <div
        role="img"
        aria-label="Distribuição de severidade dos achados em aberto"
        className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted"
      >
        {total > 0 &&
          SEV_ORDER.map((s) => {
            const n = counts[s] ?? 0;
            if (n === 0) return null;
            return (
              <div
                key={s}
                className={cn("h-full", SEV_STRIPE[s])}
                style={{ width: `${(n / total) * 100}%` }}
              />
            );
          })}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {SEV_ORDER.map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5 text-xs">
            <span className={cn("h-2 w-2 rounded-full", SEV_STRIPE[s])} />
            <span className="text-muted-foreground">{SEV_LABEL[s]}</span>
            <span className="font-semibold tabular-nums text-foreground">
              {counts[s] ?? 0}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

function PriorityRow({
  finding: f,
  onOpen,
}: {
  finding: Finding;
  onOpen: (id: string) => void;
}) {
  const retest = f.retestStatus ? RETEST_BADGE[f.retestStatus] : undefined;
  const cvss = cvssText(f);
  return (
    <button
      onClick={() => onOpen(f.id)}
      className="group relative overflow-hidden rounded-xl border bg-card p-4 text-left shadow-[var(--shadow-soft)] transition-colors hover:border-ring"
    >
      <span
        className={cn(
          "absolute inset-y-3 left-0 w-1 rounded-r-full",
          SEV_STRIPE[asSeverity(f.severity)],
        )}
      />
      <div className="flex flex-wrap items-center gap-2 pl-2">
        <SeverityBadge severity={f.severity} />
        <span className="min-w-0 flex-1 truncate font-medium text-foreground">
          {f.title}
        </span>
        {retest && <StatusBadge tone={retest.tone} label={retest.label} />}
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 pl-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Server className="h-3.5 w-3.5" /> {f.affectedAsset}
        </span>
        {cvss && <span className="font-mono">{cvss}</span>}
      </div>
    </button>
  );
}

// ── Aba Achados — tabela ordenável (honesta: conjunto COMPLETO do engajamento)
//    + chips de filtro. ─────────────────────────────────────────────────────
type FindingFilter = "todos" | "aberto" | "validados" | "vulneraveis";

function FindingsTab({
  findings,
  error,
  onOpenFinding,
}: {
  findings: Finding[] | undefined;
  error?: boolean;
  onOpenFinding: (id: string) => void;
}) {
  const [filter, setFilter] = useState<FindingFilter>("todos");
  const { sort, toggle } = useSortable<"severity" | "cvss" | "title">({
    key: "severity",
    dir: "desc",
  });

  if (error)
    return (
      <Callout tone="destructive" icon={AlertTriangle}>
        Não foi possível carregar os achados — serviço indisponível, não
        significa que nada foi encontrado. Atualize a página em instantes.
      </Callout>
    );
  if (findings === undefined) return <PanelSkeleton rows={4} />;
  if (findings.length === 0)
    return (
      <p className="py-2 text-sm text-muted-foreground">
        Nenhum achado publicado ainda.
      </p>
    );

  const chipDefs: {
    key: FindingFilter;
    label: string;
    test: (f: Finding) => boolean;
  }[] = [
    { key: "todos", label: "Todos", test: () => true },
    { key: "aberto", label: "Em aberto", test: isOpen },
    {
      key: "validados",
      label: "Validados",
      test: (f) => f.retestStatus === "fixed",
    },
    {
      key: "vulneraveis",
      label: "Ainda vulneráveis",
      test: (f) => f.retestStatus === "still_vulnerable",
    },
  ];
  const def = chipDefs.find((c) => c.key === filter) ?? chipDefs[0];
  const rows = sortRows(findings.filter(def.test), sort, {
    severity: (f) => SEV_RANK[asSeverity(f.severity)],
    cvss: (f) => f.cvssScore,
    title: (f) => f.title,
  });

  return (
    <Card className="gap-0 py-0">
      <div className="flex flex-wrap gap-2 border-b p-4">
        {chipDefs.map((c) => {
          const n = findings.filter(c.test).length;
          return (
            <button
              key={c.key}
              onClick={() => setFilter(c.key)}
              aria-pressed={filter === c.key}
              className={cn(
                "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
                filter === c.key
                  ? "border-primary/45 bg-primary/15 text-foreground"
                  : "border-border bg-card text-muted-foreground hover:border-ring",
              )}
            >
              {c.label}
              <span className="rounded-full bg-muted px-1.5 text-[11px] tabular-nums text-muted-foreground">
                {n}
              </span>
            </button>
          );
        })}
      </div>
      {rows.length === 0 ? (
        <p className="p-6 text-sm text-muted-foreground">
          Nenhum achado para este filtro.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse md:min-w-[720px]">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">
                <SortableTh
                  label="Problema"
                  sortKey="title"
                  sort={sort}
                  onSort={toggle}
                  className="px-4 py-3 font-bold"
                />
                <SortableTh
                  label="Severidade"
                  sortKey="severity"
                  sort={sort}
                  onSort={toggle}
                  numeric
                  className="px-4 py-3 font-bold"
                />
                <th className="hidden px-4 py-3 md:table-cell">Alvo</th>
                <th className="hidden px-4 py-3 md:table-cell">Classe</th>
                <SortableTh
                  label="CVSS"
                  sortKey="cvss"
                  sort={sort}
                  onSort={toggle}
                  numeric
                  className="hidden px-4 py-3 font-bold md:table-cell"
                />
                <th className="px-4 py-3">Estado</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((f) => {
                const retest = f.retestStatus
                  ? RETEST_BADGE[f.retestStatus]
                  : undefined;
                const cvss = cvssText(f);
                return (
                  <tr
                    key={f.id}
                    onClick={() => onOpenFinding(f.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onOpenFinding(f.id);
                      }
                    }}
                    tabIndex={0}
                    className="cursor-pointer border-b transition-colors last:border-0 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">
                        {f.title}
                      </div>
                      {f.ref && (
                        <div className="font-mono text-[11px] text-muted-foreground">
                          {f.ref}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <SeverityBadge severity={f.severity} />
                    </td>
                    <td className="hidden px-4 py-3 text-sm text-muted-foreground md:table-cell">
                      {f.affectedAsset}
                    </td>
                    <td className="hidden px-4 py-3 text-sm text-muted-foreground md:table-cell">
                      {f.weaknessClass}
                    </td>
                    <td className="hidden px-4 py-3 font-mono text-xs text-muted-foreground md:table-cell">
                      {cvss ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      {retest ? (
                        <StatusBadge tone={retest.tone} label={retest.label} />
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          Sem reteste
                        </span>
                      )}
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

// ── Aba Relatórios — agrupado por público; maior versão em destaque, versões
//    anteriores recolhidas; dentro de cada versão, um download por formato. ──
function ReportsTab({
  reports,
  error,
  downloading,
  onDownload,
}: {
  reports: Report[] | undefined;
  error?: boolean;
  downloading: string | null;
  onDownload: (r: Report) => void;
}) {
  if (error)
    return (
      <Callout tone="destructive" icon={AlertTriangle}>
        Não foi possível carregar os relatórios — serviço indisponível, não
        vazio. Atualize a página em instantes.
      </Callout>
    );
  if (reports === undefined) return <PanelSkeleton rows={3} />;
  if (reports.length === 0)
    return (
      <p className="py-2 text-sm text-muted-foreground">
        Nenhum relatório disponível ainda.
      </p>
    );

  // Agrupa por público; a versão incrementa por (engajamento, público) a cada
  // geração, e um reportGroupId reúne um relatório por formato na MESMA versão
  // (convex/reports.ts). Então: público → versões (maior em destaque, anteriores
  // recolhidas) → formatos. Aqui "versões anteriores" é literal, não formatos.
  const byAudience = new Map<string, Report[]>();
  for (const r of reports) {
    const arr = byAudience.get(r.audience);
    if (arr) arr.push(r);
    else byAudience.set(r.audience, [r]);
  }
  const audienceGroups = [...byAudience.entries()]
    .map(([audience, rs]) => {
      const byVersion = new Map<number, Report[]>();
      for (const r of rs) {
        const arr = byVersion.get(r.version);
        if (arr) arr.push(r);
        else byVersion.set(r.version, [r]);
      }
      const versions = [...byVersion.entries()]
        .map(([version, formats]) => ({
          version,
          formats: formats
            .slice()
            .sort((a, b) =>
              formatLabel(a.format).localeCompare(formatLabel(b.format)),
            ),
          createdAt: Math.max(...formats.map((f) => f.createdAt)),
        }))
        .sort((a, b) => b.version - a.version);
      return { audience, versions, latestAt: versions[0]?.createdAt ?? 0 };
    })
    .sort((a, b) => b.latestAt - a.latestAt);

  return (
    <div className="flex flex-col gap-4">
      {audienceGroups.map((g) => (
        <AudienceReports
          key={g.audience}
          audience={g.audience}
          versions={g.versions}
          downloading={downloading}
          onDownload={onDownload}
        />
      ))}
    </div>
  );
}

function ReportRow({
  report: r,
  downloading,
  onDownload,
  faded,
}: {
  report: Report;
  downloading: string | null;
  onDownload: (r: Report) => void;
  faded?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border bg-card px-4 py-2.5 shadow-[var(--shadow-soft)]",
        faded && "opacity-80",
      )}
    >
      <FileText className="h-4 w-4 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-foreground">
          {formatLabel(r.format)}
        </div>
        <div className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
          <span>{AUDIENCE[r.audience] ?? r.audience}</span>
          <span>· v{r.version}</span>
          <span>· {formatLabel(r.format)}</span>
          <span>· {formatDateTime(r.createdAt)}</span>
        </div>
      </div>
      <Button
        size="sm"
        onClick={() => onDownload(r)}
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
  );
}

type VersionGroup = { version: number; formats: Report[]; createdAt: number };

function AudienceReports({
  audience,
  versions,
  downloading,
  onDownload,
}: {
  audience: string;
  versions: VersionGroup[];
  downloading: string | null;
  onDownload: (r: Report) => void;
}) {
  const [latest, ...older] = versions;
  if (!latest) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 px-1">
        <span className="text-sm font-semibold text-foreground">
          {AUDIENCE[audience] ?? audience}
        </span>
        <StatusBadge tone="neutral" label={`v${latest.version}`} />
        <span className="text-xs text-muted-foreground">
          {formatDateTime(latest.createdAt)}
        </span>
      </div>
      <div className="flex flex-col gap-1.5">
        {latest.formats.map((r) => (
          <ReportRow
            key={r.id}
            report={r}
            downloading={downloading}
            onDownload={onDownload}
          />
        ))}
      </div>
      {older.length > 0 && (
        <Collapsible>
          <CollapsibleTrigger className="inline-flex w-fit items-center gap-1 pl-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
            <ChevronRight className="h-3.5 w-3.5" />
            {older.length} versão(ões) anterior(es)
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-1.5 flex flex-col gap-2.5 pl-3">
            {older.map((v) => (
              <div key={v.version} className="flex flex-col gap-1.5">
                <span className="px-1 text-xs font-medium text-muted-foreground">
                  v{v.version} · {formatDateTime(v.createdAt)}
                </span>
                {v.formats.map((r) => (
                  <ReportRow
                    key={r.id}
                    report={r}
                    downloading={downloading}
                    onDownload={onDownload}
                    faded
                  />
                ))}
              </div>
            ))}
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}

// ── TELA C — Detalhe do achado (Sheet à direita) com abas Resumo/Evidência/
//    Correção. ──────────────────────────────────────────────────────────────
type SheetTab = "resumo" | "evidencia" | "correcao";

function FindingSheet({
  finding,
  engagementName,
  evidence,
  evidenceError,
  onClose,
  onNeedEvidence,
}: {
  finding: Finding | null;
  engagementName: string;
  evidence: Evidence[] | undefined;
  evidenceError?: boolean;
  onClose: () => void;
  onNeedEvidence: (id: string) => void;
}) {
  return (
    <Sheet open={!!finding} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-y-auto p-0 sm:max-w-xl md:max-w-2xl"
      >
        {/* key=finding.id → remonta ao trocar de achado (reseta a aba sem
            setState-em-effect, que o eslint barra). */}
        {finding && (
          <FindingSheetBody
            key={finding.id}
            finding={finding}
            engagementName={engagementName}
            evidence={evidence}
            evidenceError={evidenceError}
            onNeedEvidence={onNeedEvidence}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function FindingSheetBody({
  finding,
  engagementName,
  evidence,
  evidenceError,
  onNeedEvidence,
}: {
  finding: Finding;
  engagementName: string;
  evidence: Evidence[] | undefined;
  evidenceError?: boolean;
  onNeedEvidence: (id: string) => void;
}) {
  const [stab, setStab] = useState<SheetTab>("resumo");
  const retest = finding.retestStatus
    ? RETEST_BADGE[finding.retestStatus]
    : undefined;
  const cvss = cvssText(finding);
  const tabs: TabItem<SheetTab>[] = [
    { id: "resumo", label: "Resumo" },
    { id: "evidencia", label: "Evidência" },
    { id: "correcao", label: "Correção" },
  ];
  return (
    <>
      <SheetHeader className="space-y-3 border-b bg-muted/30 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <SeverityBadge severity={finding.severity} hint />
          {retest && <StatusBadge tone={retest.tone} label={retest.label} />}
          {finding.ref && (
            <span className="font-mono text-[11.5px] text-muted-foreground">
              {finding.ref}
            </span>
          )}
        </div>
        <SheetTitle className="text-base leading-snug">
          {finding.title}
        </SheetTitle>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Server className="h-3.5 w-3.5" /> {finding.affectedAsset}
          </span>
          <span>{finding.weaknessClass}</span>
          {finding.cwe && <span className="font-mono">{finding.cwe}</span>}
          {engagementName && <span>· {engagementName}</span>}
        </div>
        {cvss && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-md bg-muted px-2 py-0.5 font-mono font-semibold text-muted-foreground">
              {cvss}
            </span>
            {finding.cvssVector && (
              <span className="font-mono text-muted-foreground">
                {finding.cvssVector}
              </span>
            )}
          </div>
        )}
      </SheetHeader>

      <div className="p-5">
        <TabBar<SheetTab>
          tabs={tabs}
          active={stab}
          onChange={(t) => {
            setStab(t);
            // Carrega a evidência ao abrir a aba (handler, não effect).
            if (t === "evidencia") onNeedEvidence(finding.id);
          }}
        />

        {stab === "resumo" && (
          <div className="mt-4 flex flex-col gap-4">
            {finding.narrative && (
              <DetailBlock label="Narrativa" text={finding.narrative} />
            )}
            {finding.description && (
              <DetailBlock label="Descrição" text={finding.description} />
            )}
            {finding.impact && (
              <DetailBlock label="Impacto" text={finding.impact} />
            )}
            {!finding.narrative && !finding.description && !finding.impact && (
              <p className="text-sm text-muted-foreground">
                Sem resumo textual registrado para este achado.
              </p>
            )}
          </div>
        )}

        {stab === "evidencia" && (
          <div className="mt-4">
            <EvidenceChain evidence={evidence} error={evidenceError} />
          </div>
        )}

        {stab === "correcao" && (
          <div className="mt-4 flex flex-col gap-4">
            {finding.remediation ? (
              <DetailBlock label="Remediação" text={finding.remediation} />
            ) : (
              <p className="text-sm text-muted-foreground">
                Sem orientação de remediação registrada.
              </p>
            )}
            <div className="rounded-lg border bg-muted/30 p-4">
              <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Reteste
              </div>
              {retest ? (
                <StatusBadge tone={retest.tone} label={retest.label} />
              ) : (
                <p className="text-sm text-muted-foreground">
                  Ainda sem reteste para este achado.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function DetailBlock({ label, text }: { label: string; text: string }) {
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

function EvidenceChain({
  evidence,
  error,
}: {
  evidence: Evidence[] | undefined;
  error?: boolean;
}) {
  if (error)
    return (
      <Callout tone="destructive" icon={AlertTriangle}>
        Não foi possível carregar a cadeia de evidência — serviço indisponível,
        não ausência de evidência.
      </Callout>
    );
  if (evidence === undefined)
    return <PanelSkeleton rows={3} className="px-0" />;
  if (evidence.length === 0)
    return (
      <p className="text-sm text-muted-foreground">
        Sem evidência anexada a este achado.
      </p>
    );

  // Ordena pela etapa (step_index) ascendente — o servidor devolve as capturas
  // mais recentes primeiro, então sem reordenar a cadeia apareceria invertida.
  // Capturas sem step_index vão ao fim, com marcador neutro (nunca um número
  // posicional fabricado).
  const ordered = evidence
    .slice()
    .sort(
      (a, b) =>
        (a.stepIndex ?? Number.MAX_SAFE_INTEGER) -
        (b.stepIndex ?? Number.MAX_SAFE_INTEGER),
    );
  const capped = evidence.length === 200;
  return (
    <div className="relative pl-1">
      {capped && (
        <div className="mb-3">
          <Callout tone="warning" icon={AlertTriangle}>
            Mostrando no máximo 200 capturas, as mais recentes. As demais estão
            no pacote de evidências.
          </Callout>
        </div>
      )}
      {ordered.map((ev, i) => (
        <div key={ev.id} className="relative flex gap-3.5 pb-4 last:pb-0">
          {i < ordered.length - 1 && (
            <span className="absolute bottom-0 left-[13px] top-8 w-0.5 bg-border" />
          )}
          <span
            className={cn(
              "z-[1] flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 bg-card text-xs font-bold shadow-[var(--shadow-soft)]",
              ev.stepIndex != null
                ? "border-primary text-primary"
                : "border-border text-muted-foreground",
            )}
          >
            {ev.stepIndex != null ? (
              ev.stepIndex
            ) : (
              <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              {ev.toolName && (
                <span className="rounded-md border border-primary/20 bg-primary/10 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-primary">
                  {ev.toolName}
                </span>
              )}
              <span className="text-xs text-muted-foreground">
                {sourceTypeLabel(ev.sourceType)}
                {ev.label ? ` · ${ev.label}` : ""}
              </span>
            </div>
            {ev.command && (
              <pre className="overflow-auto rounded-lg bg-chrome-2 px-3 py-2 font-mono text-[11.5px] leading-relaxed text-chrome-fg">
                <span className="select-none text-chrome-fg-faint">$ </span>
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
                <span className="font-semibold text-muted-foreground">
                  Resultado:
                </span>
                <span className="text-foreground/80">{ev.resultSummary}</span>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
