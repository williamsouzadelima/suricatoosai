"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  ChevronRight,
  Crosshair,
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
  type Tone,
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
  heroNumeral,
  heroTone,
  heroSentence,
  scopeCoverageLine,
  windowCoverageLine,
  formatEvidenceCount,
  truncationNotice,
  retestPortalLabel,
  selectPriorityOrder,
  plural,
  SUMMARY_ERROR_COPY,
  RISK_UNAVAILABLE_COPY,
  type PortalSummary,
  type PriorityItem,
  type PerEngagementRow,
} from "./summary-model";
import type { PortalOpenFindings } from "@/convex/lib/portalSummary";
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
interface ScopeItem {
  kind: string;
  value: string;
  inScope: boolean;
}
interface Engagement {
  id: string;
  name: string;
  code: string | null;
  status: string;
  updatedAt: number;
  startsAt: number | null;
  endsAt: number | null;
  scope: ScopeItem[];
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
  retestedAt: number | null;
  publishedAt: number | null;
  cvssVersion: string | null;
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
/** Teto da lista "ver todos" — espelha OPEN_LIST_CAP do backend (portalSummary.ts). */
const OPEN_LIST_CAP = 500;
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
function cvssText(
  f: Pick<Finding, "cvssScore" | "cvssVersion" | "cvssVector">,
): string | null {
  if (f.cvssScore == null) return null;
  const v = f.cvssVersion ?? cvssVersionFromVector(f.cvssVector);
  return `CVSS ${v ? `${v} · ` : ""}${f.cvssScore.toFixed(1)}`;
}

/** Data dd/mm/aaaa (sem hora), pt-BR. */
function fmtDateOnly(t: number): string {
  return new Date(t).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}
/** Janela autorizada "dd/mm/aaaa – dd/mm/aaaa"; null quando ambos ausentes. */
function windowText(
  startsAt: number | null,
  endsAt: number | null,
): string | null {
  if (startsAt == null && endsAt == null) return null;
  return `${startsAt == null ? "—" : fmtDateOnly(startsAt)} – ${
    endsAt == null ? "—" : fmtDateOnly(endsAt)
  }`;
}
/** Máxima data de publicação entre os achados publicados (ou null). */
function lastPublishedAt(findings: Finding[] | null | undefined): number | null {
  if (!findings || findings.length === 0) return null;
  let max: number | null = null;
  for (const f of findings) {
    if (f.publishedAt != null && (max == null || f.publishedAt > max)) {
      max = f.publishedAt;
    }
  }
  return max;
}

/** 401 numa ação deliberada do usuário: avisa e manda ao login. */
function redirectToLogin() {
  toast.error("Sessão expirada — faça login novamente.");
  window.location.href = "/login";
}

// A lista "todos em aberto" usa o TIPO DO BACKEND direto (PortalOpenFindings) —
// zero duplicação, zero drift: o import é o contrato (o bug B1 era não
// desembrulhar o envelope `{ clientId, openFindings }`, agora tipado).

export default function PortalPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // ── Estado na URL (?c=/?e=/?tab=/?f=), no padrão do operador (/achados). ──
  const clientParam = searchParams.get("c");
  const engagementId = searchParams.get("e");
  const tab = searchParams.get("tab") ?? "visao";
  const findingId = searchParams.get("f");
  const vista = searchParams.get("vista"); // "abertos" = sub-vista da lista completa

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
  const [summary, setSummary] = useState<PortalSummary | null | undefined>(
    undefined,
  );
  const [summaryErr, setSummaryErr] = useState(false);
  const [openList, setOpenList] = useState<
    PortalOpenFindings | null | undefined
  >(undefined);
  const [openListErr, setOpenListErr] = useState(false);

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
    let active = true;
    setEngagements(null);
    setEngagementsErr(false);
    (async () => {
      try {
        const res = await fetch(
          `/api/portal/engagements?clientId=${encodeURIComponent(clientId)}`,
          { cache: "no-store" },
        );
        if (!active) return;
        if (res.status === 401) {
          window.location.href = "/login";
          return;
        }
        if (!res.ok) throw new Error(`engagements ${res.status}`);
        const d = await res.json();
        if (!active) return;
        setEngagements(d.engagements ?? []);
      } catch {
        if (active) {
          setEngagementsErr(true);
          setEngagements([]);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [clientId]);

  // Resumo de portfólio (Fase 1b) — carga por cliente, guardada contra corrida
  // (uma troca de cliente cancela a resposta anterior + o eco do clientId a
  // descarta). Erro ≠ vazio: summaryErr dispara o Callout, NUNCA "tudo limpo".
  useEffect(() => {
    if (!clientId) return;
    let active = true;
    setSummary(undefined);
    setSummaryErr(false);
    (async () => {
      try {
        const res = await fetch(
          `/api/portal/summary?clientId=${encodeURIComponent(clientId)}`,
          { cache: "no-store" },
        );
        if (!active) return;
        if (res.status === 401) {
          window.location.href = "/login";
          return;
        }
        if (res.status === 404) {
          setSummary(null);
          return;
        }
        if (!res.ok) throw new Error(`summary ${res.status}`);
        const d = await res.json();
        if (!active || d.clientId !== clientId) return;
        setSummary(d.summary ?? null);
      } catch {
        if (active) setSummaryErr(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [clientId]);

  // Troca de cliente invalida a lista "em aberto" (evita flash de A sob B).
  useEffect(() => {
    setOpenList(undefined);
    setOpenListErr(false);
  }, [clientId]);

  // Lista "todos em aberto" (Fase 1c) — só carrega na sub-vista ?vista=abertos.
  // Mesmo guard de corrida do resumo (active + eco do clientId). Erro ≠ vazio.
  useEffect(() => {
    if (vista !== "abertos" || !clientId) return;
    let active = true;
    setOpenList(undefined);
    setOpenListErr(false);
    (async () => {
      try {
        const res = await fetch(
          `/api/portal/open-findings?clientId=${encodeURIComponent(clientId)}`,
          { cache: "no-store" },
        );
        if (!active) return;
        if (res.status === 401) {
          window.location.href = "/login";
          return;
        }
        if (res.status === 404) {
          setOpenList(null);
          return;
        }
        if (!res.ok) throw new Error(`open-findings ${res.status}`);
        const d = (await res.json()) as {
          clientId?: string;
          openFindings?: PortalOpenFindings;
        };
        if (!active || d.clientId !== clientId) return;
        // A rota envelopa em { clientId, openFindings } — desembrulha (como o
        // resumo faz com d.summary); guardar o envelope quebra a sub-vista.
        setOpenList(d.openFindings ?? null);
      } catch {
        if (active) setOpenListErr(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [vista, clientId]);

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
            description="Sua conta não tem acesso a nenhum portal. Fale com seu contato de segurança."
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
        ) : vista === "abertos" ? (
          <OpenFindingsView
            key={clientId ?? "none"}
            data={openList}
            error={openListErr}
            coverage={
              summary
                ? {
                    withFindings: summary.engagements.withFindings,
                    total: summary.engagements.total,
                  }
                : null
            }
            onBack={() => setParams({ vista: null })}
            onOpenFinding={(eid, fid) =>
              setParams({ e: eid, f: fid, tab: null, vista: null })
            }
          />
        ) : (
          <PortfolioView
            engagements={engagements}
            error={engagementsErr}
            summary={summary}
            summaryError={summaryErr}
            onOpen={(id) => setParams({ e: id, tab: null, f: null, vista: null })}
            onOpenFinding={(eid, fid) =>
              setParams({ e: eid, f: fid, tab: null, vista: null })
            }
            onOpenEngagementReports={(eid) =>
              setParams({ e: eid, tab: "relatorios", f: null, vista: null })
            }
            onViewAll={() => setParams({ vista: "abertos" })}
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
  planned: "Planejado",
  active: "Em andamento",
  review: "Em revisão",
  reporting: "Relatório em elaboração",
  closed: "Encerrado",
};
function portalStatusLabel(status: string): string {
  return PORTAL_STATUS_LABEL[status] ?? engagementStatusLabel(status);
}
/** Tom do pill de status NO PORTAL (não é o do operador): só "Encerrado" é
 *  verde; tudo em andamento é neutro — um engajamento aberto nunca lê verde. */
function portalStatusTone(status: string): Tone {
  return status === "closed" ? "success" : "neutral";
}
/** Ativa onClick por teclado (Enter/Espaço) para um elemento role="button". */
function onActivate(fn: () => void) {
  return (ev: KeyboardEvent) => {
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      fn();
    }
  };
}

// ── TELA A — Portfólio: cards + resumo de portfólio (Fase 1b) servido pela rota
//    /api/portal/summary; números e honestidade vêm de summary-model.ts. ──────
function PortfolioView({
  engagements,
  error,
  summary,
  summaryError,
  onOpen,
  onOpenFinding,
  onOpenEngagementReports,
  onViewAll,
}: {
  engagements: Engagement[] | null;
  error: boolean;
  summary: PortalSummary | null | undefined;
  summaryError: boolean;
  onOpen: (id: string) => void;
  onOpenFinding: (engagementId: string, findingId: string) => void;
  onOpenEngagementReports: (engagementId: string) => void;
  onViewAll: () => void;
}) {
  const perEng = useMemo(() => {
    const m = new Map<string, PerEngagementRow>();
    if (summary) for (const r of summary.perEngagement) m.set(r.engagementId, r);
    return m;
  }, [summary]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-xl font-bold tracking-tight text-foreground">
          Seus testes de segurança
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Achados publicados, correções validadas por reteste e relatórios de
          cada engajamento.
        </p>
      </div>

      {summaryError ? (
        <Callout tone="destructive" icon={AlertTriangle}>
          {SUMMARY_ERROR_COPY}
        </Callout>
      ) : summary === undefined ? (
        <PanelSkeleton rows={3} />
      ) : summary ? (
        <PortfolioSummary
          summary={summary}
          onOpenFinding={onOpenFinding}
          onOpenEngagementReports={onOpenEngagementReports}
          onViewAll={onViewAll}
        />
      ) : null}

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
            <PortfolioEngagementCard
              key={e.id}
              engagement={e}
              row={perEng.get(e.id)}
              summaryLoaded={!!summary}
              onOpen={() => onOpen(e.id)}
            />
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

// ── Resumo de portfólio (Tela A) — nível board. Honestidade no modelo PURO
//    (summary-model.ts): tom/frase/ordem vêm de lá, nada é recalculado aqui. ──
function PortfolioSummary({
  summary: s,
  onOpenFinding,
  onOpenEngagementReports,
  onViewAll,
}: {
  summary: PortalSummary;
  onOpenFinding: (engagementId: string, findingId: string) => void;
  onOpenEngagementReports: (engagementId: string) => void;
  onViewAll: () => void;
}) {
  const tone = heroTone(s);
  const numeralClass =
    tone === "destructive"
      ? "text-destructive"
      : tone === "success"
        ? "text-success"
        : tone === "muted"
          ? "text-muted-foreground"
          : "text-foreground";
  const e = s.engagements;
  const f = s.findings;

  return (
    <div className="flex flex-col gap-5">
      {truncationNotice(s) && (
        <Callout tone="warning" icon={AlertTriangle}>
          {truncationNotice(s)}
        </Callout>
      )}
      <div className="grid gap-4 lg:grid-cols-12">
        <Card className="gap-0 py-0 lg:col-span-5">
          <div className="flex flex-col gap-2.5 p-5">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Críticos e altos em aberto
            </span>
            <div
              className={cn(
                "font-display text-4xl font-bold tabular-nums",
                numeralClass,
              )}
            >
              {heroNumeral(s)}
            </div>
            <p className="text-sm text-foreground/80">{heroSentence(s)}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {scopeCoverageLine(e.withScope, e.total)} ·{" "}
              {windowCoverageLine(e.withWindow, e.total)}
            </p>
            <p className="text-xs text-muted-foreground">
              Posição em {formatDateTime(s.generatedAt)}.
            </p>
            {f.worstOpenSeverity && (
              <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                Pior severidade em aberto:{" "}
                <SeverityBadge severity={f.worstOpenSeverity} />
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              {e.byStatus.closed} de {e.total}{" "}
              {plural(
                e.total,
                "engajamento encerrado",
                "engajamentos encerrados",
              )}
              {e.byStatus.active + e.byStatus.review + e.byStatus.reporting > 0
                ? ` · ${
                    e.byStatus.active + e.byStatus.review + e.byStatus.reporting
                  } em andamento`
                : ""}
              {e.byStatus.planned > 0
                ? ` · ${e.byStatus.planned} ${plural(
                    e.byStatus.planned,
                    "planejado",
                    "planejados",
                  )}`
                : ""}
              .
            </p>
          </div>
        </Card>

        <div className="grid gap-4 sm:grid-cols-2 lg:col-span-7">
          <StatCard
            label="Engajamentos"
            value={String(e.total)}
            sub={`${
              e.byStatus.active + e.byStatus.review + e.byStatus.reporting
            } em andamento`}
            icon={Crosshair}
          />
          <StatCard
            label="Em aberto"
            value={f.published === 0 ? "—" : String(f.open)}
            sub={
              f.published === 0 ? undefined : `de ${f.published} publicados`
            }
            icon={ShieldAlert}
            tone={f.open > 0 ? "warning" : "neutral"}
          />
          <StatCard
            label="Validados por reteste"
            value={f.published === 0 ? "—" : String(f.retest.fixed)}
            sub={f.published === 0 ? undefined : `de ${f.published}`}
            icon={ShieldCheck}
            tone={f.retest.fixed > 0 ? "success" : "neutral"}
          />
          <StatCard
            label="Última publicação"
            value={
              f.lastPublishedAt != null ? fmtDateOnly(f.lastPublishedAt) : "—"
            }
            sub={
              f.publishedWithoutDate > 0
                ? `${f.publishedWithoutDate} ${plural(
                    f.publishedWithoutDate,
                    "publicado sem data registrada",
                    "publicados sem data registrada",
                  )}`
                : undefined
            }
            icon={FileText}
          />
        </div>
      </div>

      <ExecutiveReportBand reports={s.reports} onOpen={onOpenEngagementReports} />

      {f.published > 0 && (
        <div className="grid gap-4 lg:grid-cols-12">
          <Card className="gap-0 py-0 lg:col-span-7">
            <div className="flex flex-col gap-3 p-5">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Em aberto por severidade
              </span>
              <SeverityStrip counts={f.openBySeverity} />
            </div>
          </Card>
          <Card className="gap-0 py-0 lg:col-span-5">
            <div className="flex flex-col gap-3 p-5">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Situação do reteste
              </span>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                <RetestLine
                  label="Validados"
                  n={f.retest.fixed}
                  className="text-success"
                />
                <RetestLine
                  label="Ainda vulneráveis"
                  n={f.retest.stillVulnerable}
                  className="text-destructive"
                />
                <RetestLine
                  label="Pendentes"
                  n={f.retest.pending}
                  className="text-warning"
                />
                <RetestLine
                  label="Sem reteste"
                  n={f.retest.notRetested}
                  className="text-muted-foreground"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {f.lastRetestedAt != null
                  ? `Último resultado de reteste registrado em ${fmtDateOnly(
                      f.lastRetestedAt,
                    )} (data do registro do resultado, não da correção).`
                  : "Nenhum resultado de reteste registrado ainda."}
              </p>
            </div>
          </Card>
        </div>
      )}

      {s.priorities.length > 0 && (
        <div className="flex flex-col gap-2.5">
          <SectionHeader
            icon={ShieldAlert}
            title="Prioridades de correção"
            description={
              f.open > s.priorities.length
                ? `As ${s.priorities.length} primeiras na ordem de prioridade, de ${f.open} em aberto.`
                : undefined
            }
          />
          <div className="flex flex-col gap-2">
            {s.priorities.map((p) => (
              <PortfolioPriorityRow
                key={p.id}
                item={p}
                onOpen={() => onOpenFinding(p.engagementId, p.id)}
              />
            ))}
          </div>
          {f.open > s.priorities.length && (
            <Button
              variant="ghost"
              size="sm"
              className="self-start"
              onClick={onViewAll}
            >
              {f.open > OPEN_LIST_CAP
                ? `Ver os ${OPEN_LIST_CAP} primeiros de ${f.open} em aberto`
                : `Ver todos os ${f.open} em aberto`}
            </Button>
          )}
        </div>
      )}

      <Collapsible>
        <CollapsibleTrigger className="group flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
          <ChevronRight className="h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-90" />
          Como ler estes números
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2 flex flex-col gap-1.5 text-xs text-muted-foreground">
          <p>
            As contagens consideram apenas achados <strong>publicados</strong>;
            ausência de publicação não atesta ausência de risco.
          </p>
          <p>
            &ldquo;Em aberto&rdquo; = achado publicado ainda não validado como
            corrigido por reteste.
          </p>
          <p>
            Severidade é a registrada no achado; CVSS é a pontuação registrada,
            com a versão. Não é uma nota de segurança nem uma tendência, e não
            compara com outras organizações.
          </p>
          <p>
            As prioridades são ordenadas por severidade; depois, os ainda
            vulneráveis no reteste; depois, a publicação registrada mais antiga.
            O CVSS aparece quando registrado, como informação, e não define a
            ordem (3.1 e 4.0 não são diretamente comparáveis).
          </p>
          <p>
            &ldquo;Publicado em&rdquo; é a data da última publicação do achado.
            &ldquo;Último resultado de reteste&rdquo; é o resultado mais recente
            registrado pela equipe, não a data em que o problema foi corrigido.
          </p>
          <p>Um mesmo problema em dois engajamentos conta duas vezes.</p>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

function RetestLine({
  label,
  n,
  className,
}: {
  label: string;
  n: number;
  className?: string;
}) {
  return (
    <span className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-semibold tabular-nums", className)}>{n}</span>
    </span>
  );
}

// Banda de relatório executivo (Fase 1c) — o artefato de board. Sem mudança de
// servidor: usa summary.reports.latestExecutive e navega p/ a aba de relatórios
// do engajamento (não há id de relatório no payload — latestExecutive é um grupo
// multi-formato).
function ExecutiveReportBand({
  reports,
  onOpen,
}: {
  reports: PortalSummary["reports"];
  onOpen: (engagementId: string) => void;
}) {
  const le = reports.latestExecutive;
  const countLine =
    reports.available > 0
      ? `${reports.available} ${plural(
          reports.available,
          "relatório disponível",
          "relatórios disponíveis",
        )} nos engajamentos${
          reports.lastCreatedAt != null
            ? ` · último gerado em ${fmtDateOnly(reports.lastCreatedAt)}`
            : ""
        }.`
      : null;
  return (
    <Card className="gap-0 py-0">
      <div className="flex flex-col gap-3 p-5 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <FileText className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Último relatório executivo
            </span>
            {le ? (
              <>
                <div className="mt-0.5 font-semibold text-foreground">
                  {le.engagementName}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <span>
                    Versão {le.version} · Gerado em {fmtDateOnly(le.createdAt)}
                  </span>
                  {le.formats
                    .filter((fmt) => fmt.toLowerCase() !== "json")
                    .map((fmt) => (
                      <StatusBadge
                        key={fmt}
                        tone="neutral"
                        label={formatLabel(fmt)}
                      />
                    ))}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Conteúdo fixado na geração ({fmtDateOnly(le.createdAt)}); a
                  posição atual pode ter mudado. Os demais estão na aba
                  Relatórios de cada engajamento.
                </p>
                {countLine && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {countLine}
                  </p>
                )}
              </>
            ) : (
              <p className="mt-0.5 text-sm text-muted-foreground">
                Nenhum relatório executivo disponível ainda.
                {countLine ? ` ${countLine}` : ""}
              </p>
            )}
          </div>
        </div>
        {le && (
          <Button
            variant="secondary"
            size="sm"
            className="w-full shrink-0 md:w-auto"
            onClick={() => onOpen(le.engagementId)}
          >
            Abrir relatórios do engajamento
          </Button>
        )}
      </div>
    </Card>
  );
}

// Sub-vista "todos em aberto" (?vista=abertos, Fase 1c) — lista completa dos
// achados em aberto do portfólio, na mesma ordem das prioridades. Fonte única:
// rota /api/portal/open-findings. Erro ≠ vazio (TIER-1).
function OpenFindingsView({
  data,
  error,
  coverage,
  onBack,
  onOpenFinding,
}: {
  data: PortalOpenFindings | null | undefined;
  error: boolean;
  coverage: { withFindings: number; total: number } | null;
  onBack: () => void;
  onOpenFinding: (engagementId: string, findingId: string) => void;
}) {
  const [limit, setLimit] = useState(50);
  const [sevFilter, setSevFilter] = useState<Severity | null>(null);

  const header = (
    <div>
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Resumo do portfólio
      </button>
      <h1 className="mt-2 font-display text-xl font-bold tracking-tight text-foreground">
        Achados em aberto
      </h1>
    </div>
  );

  if (error) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <Callout tone="destructive" icon={AlertTriangle}>
          Não foi possível carregar a lista de achados em aberto. O serviço está
          indisponível; isso não significa ausência de achados.
        </Callout>
      </div>
    );
  }
  if (data === undefined) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <PanelSkeleton rows={6} />
      </div>
    );
  }
  if (data === null) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <EmptyState
          icon={KeyRound}
          title="Sem acesso a esta lista."
          description="Sua sessão pode ter expirado ou o acesso foi revogado. Atualize a página."
        />
      </div>
    );
  }

  const chips: { key: Severity | null; label: string; n: number }[] = [
    { key: null, label: "Todas", n: data.total },
    ...SEV_ORDER.map((sev) => ({
      key: sev,
      label: SEV_LABEL[sev],
      n: data.openBySeverity[sev],
    })),
  ];
  const shown = sevFilter
    ? data.items.filter((i) => asSeverity(i.severity) === sevFilter)
    : data.items;
  const visible = shown.slice(0, limit);

  return (
    <div className="flex flex-col gap-4">
      {header}
      <p className="text-sm text-muted-foreground">
        {data.total}{" "}
        {plural(data.total, "achado em aberto", "achados em aberto")}. Em aberto
        = publicado e ainda não validado por reteste.
      </p>
      <p className="text-xs text-muted-foreground">
        Ordem de prioridade: severidade; depois, os ainda vulneráveis no reteste;
        depois, a data de publicação registrada mais antiga. O CVSS aparece
        quando registrado, como informação, e não define a ordem (3.1 e 4.0 não
        são comparáveis). Posição em {formatDateTime(data.generatedAt)}.
      </p>

      {data.scanTruncated && (
        <Callout tone="warning" icon={AlertTriangle}>
          Resumo parcial: o volume excede o limite de leitura; os números podem
          estar incompletos. Achados criados há mais tempo podem estar fora desta
          lista.
        </Callout>
      )}

      {data.total === 0 ? (
        coverage &&
        coverage.withFindings === coverage.total &&
        !data.scanTruncated ? (
          <EmptyState
            icon={ShieldCheck}
            title="Nenhum achado em aberto."
            description="Todos os achados publicados foram validados por reteste neste portfólio."
          />
        ) : (
          <EmptyState
            icon={ListChecks}
            title="Nenhum achado em aberto entre os achados carregados."
            description={`${
              coverage && coverage.withFindings < coverage.total
                ? `Engajamentos com achados publicados: ${coverage.withFindings} de ${coverage.total}. `
                : ""
            }${
              data.scanTruncated
                ? "Resumo parcial: o volume excede o limite de leitura."
                : ""
            }`.trim()}
          />
        )
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            {chips.map((c) => (
              <button
                key={c.label}
                type="button"
                aria-pressed={sevFilter === c.key}
                onClick={() => {
                  setSevFilter(c.key);
                  setLimit(50);
                }}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                  sevFilter === c.key
                    ? "border-ring bg-primary/10 text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {c.label} <span className="tabular-nums">{c.n}</span>
              </button>
            ))}
          </div>

          {data.listCapped && (
            <p className="text-xs text-muted-foreground">
              Lista completa: os {data.items.length} primeiros de {data.total} em
              aberto, na ordem de prioridade (os demais excedem o limite de
              leitura).
            </p>
          )}

          <div className="flex flex-col gap-2">
            {visible.map((p) => {
              const retest = p.retestStatus
                ? RETEST_BADGE[p.retestStatus]
                : undefined;
              const cvss = cvssText(p);
              return (
                <div
                  key={p.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`Abrir achado ${p.title} (${p.engagementName})`}
                  onClick={() => onOpenFinding(p.engagementId, p.id)}
                  onKeyDown={onActivate(() =>
                    onOpenFinding(p.engagementId, p.id),
                  )}
                  className="group relative cursor-pointer overflow-hidden rounded-xl border bg-card p-4 text-left shadow-[var(--shadow-soft)] transition-colors hover:border-ring focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span
                    className={cn(
                      "absolute inset-y-3 left-0 w-1 rounded-r-full",
                      SEV_STRIPE[asSeverity(p.severity)],
                    )}
                  />
                  <div className="flex flex-wrap items-center gap-2 pl-2">
                    <SeverityBadge severity={p.severity} />
                    <span className="min-w-0 flex-1 font-medium text-foreground">
                      {p.title}
                    </span>
                    {retest && p.retestStatus && (
                      <StatusBadge
                        tone={retest.tone}
                        label={retestPortalLabel(p.retestStatus)}
                      />
                    )}
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 pl-2 text-xs text-muted-foreground">
                    {p.ref && <span className="font-mono">{p.ref}</span>}
                    <span className="inline-flex items-center gap-1">
                      <ListChecks className="h-3.5 w-3.5" /> {p.engagementName}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Server className="h-3.5 w-3.5" /> {p.affectedAsset}
                    </span>
                    {cvss ? (
                      <span className="font-mono">{cvss}</span>
                    ) : (
                      <span className="text-muted-foreground/70">
                        CVSS não registrado
                      </span>
                    )}
                    {p.publishedAt != null ? (
                      <span>Publicado em {fmtDateOnly(p.publishedAt)}</span>
                    ) : (
                      <span className="text-muted-foreground/70">
                        Publicação sem data registrada
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {visible.length === 0 && sevFilter && (
            <p className="text-xs text-muted-foreground">
              {data.listCapped
                ? `Nenhum achado ${SEV_LABEL[sevFilter]} entre os ${
                    data.items.length
                  } exibidos (${
                    data.total - data.items.length
                  } além do limite de leitura).`
                : `Nenhum achado ${SEV_LABEL[sevFilter]} nesta lista.`}
            </p>
          )}

          {shown.length > limit && (
            <Button
              variant="ghost"
              size="sm"
              className="self-start"
              onClick={() => setLimit((l) => l + 50)}
            >
              Mostrar mais {Math.min(50, shown.length - limit)}
            </Button>
          )}
        </>
      )}
    </div>
  );
}

function PortfolioPriorityRow({
  item: p,
  onOpen,
}: {
  item: PriorityItem;
  onOpen: () => void;
}) {
  const retest = p.retestStatus ? RETEST_BADGE[p.retestStatus] : undefined;
  const cvss = cvssText(p);
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Abrir achado ${p.title} (${p.engagementName})`}
      onClick={onOpen}
      onKeyDown={onActivate(onOpen)}
      className="group relative cursor-pointer overflow-hidden rounded-xl border bg-card p-4 text-left shadow-[var(--shadow-soft)] transition-colors hover:border-ring focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span
        className={cn(
          "absolute inset-y-3 left-0 w-1 rounded-r-full",
          SEV_STRIPE[asSeverity(p.severity)],
        )}
      />
      <div className="flex flex-wrap items-center gap-2 pl-2">
        <SeverityBadge severity={p.severity} />
        <span className="min-w-0 flex-1 font-medium text-foreground">
          {p.title}
        </span>
        {retest && p.retestStatus && (
          <StatusBadge
            tone={retest.tone}
            label={retestPortalLabel(p.retestStatus)}
          />
        )}
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 pl-2 text-xs text-muted-foreground">
        {p.ref && <span className="font-mono">{p.ref}</span>}
        <span className="inline-flex items-center gap-1">
          <ListChecks className="h-3.5 w-3.5" /> {p.engagementName}
        </span>
        <span className="inline-flex items-center gap-1">
          <Server className="h-3.5 w-3.5" /> {p.affectedAsset}
        </span>
        {cvss ? (
          <span className="font-mono">{cvss}</span>
        ) : (
          <span className="text-muted-foreground/70">CVSS não registrado</span>
        )}
        {p.publishedAt != null ? (
          <span>Publicado em {fmtDateOnly(p.publishedAt)}</span>
        ) : (
          <span className="text-muted-foreground/70">
            Publicação sem data registrada
          </span>
        )}
        {p.evidenceCount === 0 ? (
          <span className="text-warning">Sem evidência registrada</span>
        ) : (
          <span>
            {formatEvidenceCount(p.evidenceCount)}{" "}
            {plural(p.evidenceCount, "evidência", "evidências")}
          </span>
        )}
      </div>
    </div>
  );
}

function PortfolioEngagementCard({
  engagement: e,
  row,
  summaryLoaded,
  onOpen,
}: {
  engagement: Engagement;
  row: PerEngagementRow | undefined;
  summaryLoaded: boolean;
  onOpen: () => void;
}) {
  const win = windowText(e.startsAt, e.endsAt);
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Abrir engajamento ${e.name}`}
      onClick={onOpen}
      onKeyDown={onActivate(onOpen)}
      className="group cursor-pointer rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Card className="gap-0 py-0 transition-colors group-hover:border-ring">
        <div className="flex items-start gap-3 p-5">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <ShieldCheck className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-foreground">{e.name}</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              {e.code && <span className="font-mono">{e.code}</span>}
              <span>{win ? `Janela ${win}` : "Janela não informada"}</span>
            </div>
            {row ? (
              <EngagementRiskLine row={row} status={e.status} />
            ) : summaryLoaded ? (
              <div className="mt-2 text-xs text-warning">
                {RISK_UNAVAILABLE_COPY}
              </div>
            ) : null}
          </div>
          <StatusBadge
            tone={portalStatusTone(e.status)}
            label={portalStatusLabel(e.status)}
          />
          <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </div>
      </Card>
    </div>
  );
}

function EngagementRiskLine({
  row,
  status,
}: {
  row: PerEngagementRow;
  status: string;
}) {
  const closed = status === "closed";
  const closedWithRisk = closed && row.openCriticalHigh > 0;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      {row.published === 0 ? (
        <span className="text-muted-foreground">
          Sem achados publicados{!closed && " · em andamento"}
        </span>
      ) : row.open === 0 ? (
        // Verde "validado" só num engajamento ENCERRADO; em andamento = neutro.
        <span
          className={closed ? "font-medium text-success" : "text-foreground/80"}
        >
          {row.published === 1
            ? "O único achado publicado foi validado por reteste"
            : `Todos os ${row.published} validados por reteste`}
          {!closed && " · em andamento"}
        </span>
      ) : (
        <>
          {row.worstOpenSeverity && (
            <SeverityBadge severity={row.worstOpenSeverity} />
          )}
          <span className="text-foreground/80">
            {row.open} em aberto
            {row.openCriticalHigh > 0 &&
              ` · ${row.openCriticalHigh} ${plural(
                row.openCriticalHigh,
                "crítico/alto",
                "críticos/altos",
              )}`}
          </span>
        </>
      )}
      {closedWithRisk && (
        <StatusBadge
          tone="warning"
          label="Encerrado com crítico/alto em aberto"
        />
      )}
      {row.lastPublishedAt != null && (
        <span className="text-muted-foreground">
          · Última publicação {fmtDateOnly(row.lastPublishedAt)}
        </span>
      )}
    </div>
  );
}

// ── TELA B — Engajamento (hero por engajamento + abas). ────────────────────
type EngTab = "visao" | "escopo" | "achados" | "relatorios" | "evidencia";

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
  const win = windowText(engagement.startsAt, engagement.endsAt);
  const lastPub = lastPublishedAt(findings);
  const scope = engagement.scope ?? [];
  const showScopeTab = scope.length > 0 || win != null;
  const validTabs: EngTab[] = [
    "visao",
    ...(showScopeTab ? (["escopo"] as EngTab[]) : []),
    "achados",
    "relatorios",
    "evidencia",
  ];
  const active: EngTab = validTabs.includes(tab as EngTab)
    ? (tab as EngTab)
    : "visao";

  const tabs: TabItem<EngTab>[] = [
    { id: "visao", label: "Visão geral", icon: LayoutDashboard },
    ...(showScopeTab
      ? ([
          { id: "escopo", label: "Escopo & janela", icon: Crosshair },
        ] as TabItem<EngTab>[])
      : []),
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
            <span>Janela {win ?? "não informada"}</span>
            {!findingsError && lastPub != null && (
              <span>Última publicação {fmtDateOnly(lastPub)}</span>
            )}
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
      {active === "escopo" && (
        <ScopeWindowTab scope={scope} windowLabel={win} />
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

const SCOPE_KIND_LABEL: Record<string, string> = {
  domain: "Domínio",
  ip: "IP",
  cidr: "Faixa (CIDR)",
  url: "URL",
  app: "Aplicação",
  other: "Outro",
};

// Aba "Escopo & janela" (Tela B): alvos autorizados/testados + período.
// O escopo chega dentro do engagement JÁ carregado — não há fetch nem estado
// de erro próprios, então scope: [] é inequívoco (o engajamento carregou; o
// escopo não foi itemizado). A cópia usa "não informado" (ausência de
// registro), nunca "nada no escopo"; e "Alvos fora desta lista não foram
// testados." só aparece quando há lista — afirmar fronteira de cobertura sem
// dados seria tratar ausência como presença.
function ScopeWindowTab({
  scope,
  windowLabel,
}: {
  scope: ScopeItem[];
  windowLabel: string | null;
}) {
  return (
    <div className="flex flex-col gap-3">
      <SectionHeader
        icon={Crosshair}
        title="Escopo & janela"
        description="Alvos autorizados para teste e período de execução deste engajamento."
      />
      <Card className="py-0">
        <div className="flex flex-wrap items-center justify-between gap-2 p-5">
          <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Janela autorizada
          </span>
          <span className="text-sm font-medium text-foreground">
            {windowLabel ?? "Não informada"}
          </span>
        </div>
      </Card>
      {scope.length > 0 ? (
        <>
          <Card className="py-0">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse md:min-w-[520px]">
                <thead>
                  <tr className="border-b bg-muted/40 text-left text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3">Tipo</th>
                    <th className="px-4 py-3">Alvo</th>
                    <th className="px-4 py-3">Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {scope.map((s, i) => (
                    <tr
                      key={`${s.kind}:${s.value}:${i}`}
                      className="border-b last:border-0"
                    >
                      <td className="px-4 py-3 text-sm text-muted-foreground">
                        {SCOPE_KIND_LABEL[s.kind] ?? s.kind}
                      </td>
                      <td className="px-4 py-3 font-mono text-[13px] text-foreground">
                        {s.value}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge
                          tone={s.inScope ? "success" : "neutral"}
                          label={s.inScope ? "No escopo" : "Fora do escopo"}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <p className="text-xs text-muted-foreground">
            Alvos fora desta lista não foram testados.
          </p>
        </>
      ) : (
        <Callout tone="neutral" icon={Crosshair}>
          O escopo detalhado deste engajamento não foi informado no portal.
        </Callout>
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
  // Mesma ordem da Tela A (comparePriority): severidade → ainda-vulnerável →
  // publicado mais antigo → id (CVSS NÃO ordena), p/ Tela A e B não divergirem.
  const priorities = selectPriorityOrder(open).slice(0, 5);
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
        title="Nenhum achado publicado."
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
                    ? `${s.sevCounts.critical} ${plural(s.sevCounts.critical, "crítico", "críticos")} e ${s.sevCounts.high} ${plural(s.sevCounts.high, "alto", "altos")} sem correção validada por reteste.`
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
              {s.open.length} em aberto · {s.retest.fixed}{" "}
              {plural(s.retest.fixed, "validado", "validados")} por reteste
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
        <span className="min-w-0 flex-1 font-medium text-foreground">
          {f.title}
        </span>
        {retest && (
          <StatusBadge
            tone={retest.tone}
            label={retestPortalLabel(f.retestStatus)}
          />
        )}
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
        Nenhum achado publicado.
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
                        <StatusBadge
                          tone={retest.tone}
                          label={retestPortalLabel(f.retestStatus)}
                        />
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
        Nenhum relatório disponível.
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
            {older.length}{" "}
            {plural(older.length, "versão anterior", "versões anteriores")}
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
          {retest && (
            <StatusBadge
              tone={retest.tone}
              label={retestPortalLabel(finding.retestStatus)}
            />
          )}
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
          {finding.publishedAt != null && (
            <span>· Publicado em {fmtDateOnly(finding.publishedAt)}</span>
          )}
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
            {finding.retestStatus === "fixed" &&
              finding.retestedAt != null && (
                <Callout tone="success" icon={ShieldCheck}>
                  <span className="font-semibold">
                    Validado por reteste em {fmtDateOnly(finding.retestedAt)}.
                  </span>
                </Callout>
              )}
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
                <StatusBadge
                  tone={retest.tone}
                  label={retestPortalLabel(finding.retestStatus)}
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  Sem reteste para este achado.
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
