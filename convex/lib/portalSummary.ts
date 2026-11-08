/**
 * Resumo de portfólio do PORTAL do cliente (Fase 1b) — lógica PURA.
 *
 * Importa SÓ tipos (erasados) → NÃO carrega fileAggregate nem @convex-dev/aggregate
 * (o ESM que derruba o jest). Testável com um ctx-stub mínimo (ver
 * convex/__tests__/portalSummary.test.ts), no mesmo padrão de evidenceDeletePlan.
 *
 * `buildPortalSummary` recebe `resolveMembership` POR PARÂMETRO (injeção) para
 * não criar ciclo com convex/portal.ts e para tornar a NEGAÇÃO testável.
 *
 * Honestidade (o revisor adversarial caça isto): nenhum score/nota/tendência
 * fabricado; só contagens reais e derivações "x de y". Campos sensíveis
 * (retest_note, reproduction_steps, source_*, reviewed_by, dedup_fingerprint,
 * verdict, confidence, …) NUNCA entram em nenhum campo do resumo.
 */
import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

export const SEVERITIES = [
  "critical",
  "high",
  "medium",
  "low",
  "info",
] as const;
export const SEV_RANK: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

/** Teto de leitura de achados por engajamento (defensivo; clientes reais ficam
 *  muito abaixo). Estourou → `truncated=true`, nunca subcontagem silenciosa. */
export const FINDINGS_CAP_PER_ENGAGEMENT = 2000;
export const EVIDENCE_COUNT_CAP = 200;
const TOP_PRIORITIES = 5;

export type Severity = (typeof SEVERITIES)[number];

/** Forma mínima que o comparador de prioridade precisa. */
export interface PriorityKey {
  severity: string;
  cvssScore: number | null;
  publishedAt: number | null;
  id: string;
}

export interface PriorityItem extends PriorityKey {
  id: Id<"findings">;
  engagementId: Id<"engagements">;
  engagementName: string;
  ref: string | null;
  title: string;
  affectedAsset: string;
  weaknessClass: string;
  cwe: string | null;
  cvssVersion: string | null;
  cvssVector: string | null;
  retestStatus: string | null;
  evidenceCount: number;
}

export interface PerEngagementRow {
  engagementId: Id<"engagements">;
  engagementName: string;
  status: string;
  published: number;
  open: number;
  openCriticalHigh: number;
  worstOpenSeverity: string | null;
  lastPublishedAt: number | null;
}

export interface PortalSummary {
  generatedAt: number;
  truncated: boolean;
  engagements: {
    total: number;
    withFindings: number;
    byStatus: {
      planned: number;
      active: number;
      review: number;
      reporting: number;
      closed: number;
    };
    withWindow: number;
    withScope: number;
  };
  findings: {
    published: number;
    publishedWithoutDate: number;
    open: number;
    openBySeverity: {
      critical: number;
      high: number;
      medium: number;
      low: number;
      info: number;
    };
    openCriticalHigh: number;
    worstOpenSeverity: string | null;
    retest: {
      fixed: number;
      stillVulnerable: number;
      pending: number;
      notRetested: number;
    };
    lastPublishedAt: number | null;
    lastRetestedAt: number | null;
  };
  priorities: PriorityItem[];
  perEngagement: PerEngagementRow[];
  reports: {
    available: number;
    lastCreatedAt: number | null;
    latestExecutive: null | {
      engagementId: Id<"engagements">;
      engagementName: string;
      version: number;
      createdAt: number;
      formats: string[];
    };
  };
}

/** desc por número, nulos SEMPRE por último (sem NaN de Infinity-Infinity). */
function cmpNumDescNullsLast(a: number | null, b: number | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b - a;
}

/** Ordem de prioridade: severidade desc → CVSS desc (nulo por último) →
 *  publicado desc (nulo por último) → id asc (desempate estável). */
export function comparePriority(a: PriorityKey, b: PriorityKey): number {
  const ra = SEV_RANK[a.severity] ?? -1;
  const rb = SEV_RANK[b.severity] ?? -1;
  if (ra !== rb) return rb - ra;
  const c = cmpNumDescNullsLast(a.cvssScore, b.cvssScore);
  if (c !== 0) return c;
  const p = cmpNumDescNullsLast(a.publishedAt, b.publishedAt);
  if (p !== 0) return p;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function selectPriorityOrder<T extends PriorityKey>(items: T[]): T[] {
  return [...items].sort(comparePriority);
}

/** Pior severidade ABERTA presente (string canônica) ou null se nada aberto. */
export function worstOpenSeverity(
  items: { severity: string }[],
): string | null {
  let worst: string | null = null;
  let worstRank = -1;
  for (const it of items) {
    const r = SEV_RANK[it.severity] ?? -1;
    if (r > worstRank) {
      worstRank = r;
      worst = it.severity;
    }
  }
  return worst;
}

function maxOrNull(
  a: number | null,
  b: number | null | undefined,
): number | null {
  if (b === null || b === undefined) return a;
  if (a === null) return b;
  return b > a ? b : a;
}

export type ResolveMembershipFn = (
  ctx: QueryCtx,
  userId: string,
  clientId: Id<"clients">,
) => Promise<{ client: Doc<"clients"> } | null>;

/**
 * Lê o banco (engajamentos VISÍVEIS → achados publicados → relatórios → evidência
 * dos top-5) e agrega o resumo. NEGA por padrão via `resolveMembership`
 * (injetado): sem acesso → `null` (NUNCA um objeto zerado, que o cliente leria
 * como "tudo limpo"). Só lê achados dos engajamentos visíveis → achado de
 * engajamento arquivado/hard-deletado jamais é contado.
 */
export async function buildPortalSummary(
  ctx: QueryCtx,
  args: { userId: string; clientId: Id<"clients">; nowMs: number },
  resolveMembership: ResolveMembershipFn,
): Promise<PortalSummary | null> {
  const access = await resolveMembership(ctx, args.userId, args.clientId);
  if (!access) return null;

  let truncated = false;

  // Engajamentos visíveis (mesma fonte da listagem; reconciliação por construção).
  const engagements = await listVisibleEngagements(ctx, args.clientId);
  const nameById = new Map<string, string>();
  for (const e of engagements) nameById.set(e._id as string, e.name);

  const byStatus = {
    planned: 0,
    active: 0,
    review: 0,
    reporting: 0,
    closed: 0,
  };
  let withWindow = 0;
  let withScope = 0;
  let withFindings = 0;

  const openBySeverity = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };
  const retest = { fixed: 0, stillVulnerable: 0, pending: 0, notRetested: 0 };
  let published = 0;
  let publishedWithoutDate = 0;
  let open = 0;
  let lastPublishedAt: number | null = null;
  let lastRetestedAt: number | null = null;

  const openFindings: PriorityItem[] = [];
  const perEngagement: PerEngagementRow[] = [];

  for (const e of engagements) {
    if (e.status in byStatus) {
      byStatus[e.status as keyof typeof byStatus] += 1;
    }
    if (e.starts_at != null || e.ends_at != null) withWindow += 1;
    if ((e.scope ?? []).length > 0) withScope += 1;

    // order("desc") ANTES do take: se estourar o teto, descarta os MAIS ANTIGOS
    // (mantém os recentes, que dirigem lastPublishedAt + o top-5).
    const fs = await ctx.db
      .query("findings")
      .withIndex("by_engagement_and_status", (q) =>
        q.eq("engagement_id", e._id).eq("status", "published"),
      )
      .order("desc")
      .take(FINDINGS_CAP_PER_ENGAGEMENT);
    if (fs.length >= FINDINGS_CAP_PER_ENGAGEMENT) truncated = true;
    if (fs.length > 0) withFindings += 1;

    const row: PerEngagementRow = {
      engagementId: e._id,
      engagementName: nameById.get(e._id as string) ?? e.name,
      status: e.status,
      published: fs.length,
      open: 0,
      openCriticalHigh: 0,
      worstOpenSeverity: null,
      lastPublishedAt: null,
    };
    const rowOpenSevs: { severity: string }[] = [];

    for (const f of fs) {
      published += 1;
      if (f.published_at == null) publishedWithoutDate += 1;
      lastPublishedAt = maxOrNull(lastPublishedAt, f.published_at ?? null);
      row.lastPublishedAt = maxOrNull(
        row.lastPublishedAt,
        f.published_at ?? null,
      );

      switch (f.retest_status) {
        case "fixed":
          retest.fixed += 1;
          lastRetestedAt = maxOrNull(lastRetestedAt, f.retested_at ?? null);
          break;
        case "still_vulnerable":
          retest.stillVulnerable += 1;
          lastRetestedAt = maxOrNull(lastRetestedAt, f.retested_at ?? null);
          break;
        case "pending":
          retest.pending += 1;
          break;
        default:
          retest.notRetested += 1;
      }

      // Aberto = publicado ainda não validado como corrigido por reteste.
      const isOpen = f.retest_status !== "fixed";
      if (isOpen) {
        open += 1;
        if (f.severity in openBySeverity) {
          openBySeverity[f.severity as keyof typeof openBySeverity] += 1;
        }
        row.open += 1;
        if (f.severity === "critical" || f.severity === "high") {
          row.openCriticalHigh += 1;
        }
        rowOpenSevs.push({ severity: f.severity });
        openFindings.push({
          id: f._id,
          engagementId: e._id,
          engagementName: nameById.get(e._id as string) ?? e.name,
          ref: f.finding_id ?? null,
          title: f.title,
          severity: f.severity,
          affectedAsset: f.affected_asset,
          weaknessClass: f.weakness_class,
          cwe: f.cwe ?? null,
          cvssScore: f.cvss_score ?? null,
          cvssVersion: f.cvss_version ?? null,
          cvssVector: f.cvss_vector ?? null,
          retestStatus: f.retest_status ?? null,
          publishedAt: f.published_at ?? null,
          evidenceCount: 0,
        });
      }
    }
    row.worstOpenSeverity = worstOpenSeverity(rowOpenSevs);
    perEngagement.push(row);
  }

  const openCriticalHigh = openBySeverity.critical + openBySeverity.high;
  const worstOpen = worstOpenSeverity(openFindings);

  // Top-5 prioridades + contagem de evidência SÓ delas (leitura limitada).
  const top = selectPriorityOrder(openFindings).slice(0, TOP_PRIORITIES);
  for (const p of top) {
    const ev = await ctx.db
      .query("evidence")
      .withIndex("by_finding_and_captured", (q) => q.eq("finding_id", p.id))
      .take(EVIDENCE_COUNT_CAP);
    p.evidenceCount = ev.length;
  }

  // Relatórios PRONTOS/visíveis (mesmo filtro da lista do portal). `available` =
  // ENTREGÁVEIS distintos (report_group_id), NÃO linhas-por-formato (reports.ts
  // insere uma linha por formato com o mesmo group_id). Datas usam
  // generated_at ?? created_at (mesma convenção do download, portal.ts).
  const availableGroups = new Set<string>();
  let lastCreatedAt: number | null = null;
  const execGroups = new Map<string, Doc<"reports">[]>();
  for (const e of engagements) {
    const reps = await ctx.db
      .query("reports")
      .withIndex("by_engagement", (q) => q.eq("engagement_id", e._id))
      .collect();
    for (const r of reps) {
      if (
        r.status !== "ready" ||
        r.client_visible === false ||
        r.deleted_at !== undefined
      ) {
        continue;
      }
      availableGroups.add(r.report_group_id);
      lastCreatedAt = maxOrNull(lastCreatedAt, r.generated_at ?? r.created_at);
      if (r.audience === "executive") {
        const g = execGroups.get(r.report_group_id) ?? [];
        g.push(r);
        execGroups.set(r.report_group_id, g);
      }
    }
  }
  const reportsAvailable = availableGroups.size;

  // latestExecutive = o GRUPO executivo mais RECENTE por DATA (generated_at ??
  // created_at). `version` é a versão DESSE grupo — NUNCA comparada entre
  // engajamentos (version é por engagement+audience, incomparável).
  let latestExecutive: PortalSummary["reports"]["latestExecutive"] = null;
  let latestExecDate = -Infinity;
  for (const rows of execGroups.values()) {
    const date = Math.max(...rows.map((r) => r.generated_at ?? r.created_at));
    if (date > latestExecDate) {
      latestExecDate = date;
      const engagementId = rows[0].engagement_id;
      latestExecutive = {
        engagementId,
        engagementName: nameById.get(engagementId as string) ?? "",
        version: rows[0].version,
        createdAt: date,
        formats: [...new Set(rows.map((r) => r.format))].sort(),
      };
    }
  }

  return {
    generatedAt: args.nowMs,
    truncated,
    engagements: {
      total: engagements.length,
      withFindings,
      byStatus,
      withWindow,
      withScope,
    },
    findings: {
      published,
      publishedWithoutDate,
      open,
      openBySeverity,
      openCriticalHigh,
      worstOpenSeverity: worstOpen,
      retest,
      lastPublishedAt,
      lastRetestedAt,
    },
    priorities: top,
    perEngagement,
    reports: {
      available: reportsAvailable,
      lastCreatedAt,
      latestExecutive,
    },
  };
}

/** Engajamentos VISÍVEIS (não arquivados, não hard-deletados), desc por
 *  atualização. Fonte ÚNICA compartilhada com listPortalEngagementsForBackend
 *  (garante a reconciliação header == soma das linhas). */
export async function listVisibleEngagements(
  ctx: QueryCtx,
  clientId: Id<"clients">,
): Promise<Doc<"engagements">[]> {
  return (
    await ctx.db
      .query("engagements")
      .withIndex("by_client_and_updated", (q) => q.eq("client_id", clientId))
      .order("desc")
      .collect()
  ).filter((e) => !e.hard_deleted_at && !e.archived_at);
}

/** Linha de auditoria da visualização do resumo (trilha honesta: evento
 *  DEDICADO, não reaproveita finding.viewed; sem engagement_id — abrange o
 *  portfólio). O chamador insere em security_audit_log. */
export function buildPortalSummaryAuditRow(
  args: {
    userId: string;
    clientId: Id<"clients">;
    actorEmail?: string;
    ip?: string;
    userAgent?: string;
    organizationId?: string;
  },
  granted: boolean,
  published: number,
  engagements: number,
  nowMs: number,
) {
  return {
    event_type: (granted ? "portal.summary_viewed" : "access.denied") as
      "portal.summary_viewed" | "access.denied",
    actor_user_id: args.userId,
    actor_email: args.actorEmail,
    actor_kind: "client" as const,
    organization_id: args.organizationId,
    client_id: args.clientId,
    target_type: "portfolio_summary",
    target_id: args.clientId as string,
    ip: args.ip,
    user_agent: args.userAgent?.slice(0, 500),
    outcome: (granted ? "success" : "denied") as "success" | "denied",
    detail: `resumo do portfólio (portal): ${published} achado(s) publicado(s) em ${engagements} engajamento(s)`,
    created_at: nowMs,
  };
}
