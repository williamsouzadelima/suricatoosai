import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { validateServiceKey } from "./lib/utils";

/**
 * Relatórios: registro de solicitação/versão + insumo (getReportInput) para o
 * renderer. O relatório é montado (ReportModel) e renderizado no job do trigger
 * (lib/reports/* + packages/report-renderer). Só achados aprovados/publicados
 * entram no relatório (portão de curadoria).
 */

const audienceArg = v.union(
  v.literal("technical"),
  v.literal("executive"),
  v.literal("commercial"),
);
const formatArg = v.union(
  v.literal("docx"),
  v.literal("pptx"),
  v.literal("pdf"),
);

const EVIDENCE_PER_FINDING = 20;

function newGroupId(): string {
  return `rg_${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

/**
 * Insumo do relatório para o renderer (serviceKey, chamado pelo job do trigger).
 * Retorna cliente + engajamento + achados aprovados/publicados com evidência.
 * A tenancy é derivada do engajamento; o job passa userId para conferência.
 */
export const getReportInputForBackend = query({
  args: {
    serviceKey: v.string(),
    userId: v.string(),
    engagementId: v.id("engagements"),
  },
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const engagement = await ctx.db.get(args.engagementId);
    if (!engagement || engagement.user_id !== args.userId) {
      throw new ConvexError({ code: "ACCESS_DENIED", message: "Sem acesso" });
    }
    const client = await ctx.db.get(engagement.client_id);

    // Marca do relatório: org (MSSP) → fallback pelo dono do engajamento →
    // DEFAULT_BRAND no builder (lib/reports). Campos ausentes caem para o padrão.
    const mapBrandRow = (row: {
      name?: string;
      wordmark?: string;
      tagline?: string;
      contact?: string;
      doc_code_prefix?: string;
      primary?: string;
      accent?: string;
      classification?: string;
    }) => ({
      name: row.name,
      wordmark: row.wordmark,
      tagline: row.tagline,
      contact: row.contact,
      docCodePrefix: row.doc_code_prefix,
      primary: row.primary,
      accent: row.accent,
      classification: row.classification,
    });
    let brand: ReturnType<typeof mapBrandRow> | undefined;
    let brandLogo: { s3Key: string; mediaType?: string } | undefined;
    const applyBrandRow = (
      row: Parameters<typeof mapBrandRow>[0] & {
        logo_s3_key?: string;
        logo_media_type?: string;
      },
    ) => {
      brand = mapBrandRow(row);
      if (row.logo_s3_key)
        brandLogo = { s3Key: row.logo_s3_key, mediaType: row.logo_media_type };
    };
    if (engagement.organization_id) {
      const orgId = engagement.organization_id;
      const row = await ctx.db
        .query("report_brands")
        .withIndex("by_org", (q) => q.eq("organization_id", orgId))
        .first();
      if (row) applyBrandRow(row);
    }
    if (!brand) {
      const row = await ctx.db
        .query("report_brands")
        .withIndex("by_user", (q) => q.eq("user_id", args.userId))
        .first();
      if (row) applyBrandRow(row);
    }

    // Inclui todos os achados NÃO descartados (rascunho/revisão/aprovado/
    // publicado). O relatório é gerado pelo analista sob demanda; findings
    // descartados (dismissed) ficam de fora. (v2 portal do cliente pode
    // restringir a aprovados/publicados.)
    const published = (
      await ctx.db
        .query("findings")
        .withIndex("by_engagement_and_updated", (q) =>
          q.eq("engagement_id", args.engagementId),
        )
        .collect()
    ).filter((f) => f.status !== "dismissed");

    const findings = [];
    for (const f of published) {
      const evRaw = await ctx.db
        .query("evidence")
        .withIndex("by_finding_and_captured", (q) => q.eq("finding_id", f._id))
        .order("desc")
        .take(EVIDENCE_PER_FINDING);
      // Ordena pela cadeia (step_index; sem índice → pelo tempo de captura).
      const ev = evRaw
        .slice()
        .sort(
          (a, b) =>
            (a.step_index ?? Number.MAX_SAFE_INTEGER) -
              (b.step_index ?? Number.MAX_SAFE_INTEGER) ||
            a.captured_at - b.captured_at,
        );
      findings.push({
        ref: f.finding_id,
        title: f.title,
        severity: f.severity,
        affectedAsset: f.affected_asset,
        weaknessClass: f.weakness_class,
        cwe: f.cwe,
        cvssVector: f.cvss_vector,
        cvssScore: f.cvss_score,
        description: f.description,
        impact: f.impact,
        remediation: f.remediation,
        narrative: f.narrative,
        reproductionSteps: f.reproduction_steps ?? [],
        evidence: ev.map((e) => ({
          sourceType: e.source_type,
          label: e.label,
          snippet: e.snippet,
          stepIndex: e.step_index ?? null,
          toolName: e.tool_name ?? null,
          command: e.command ?? null,
          resultSummary: e.result_summary ?? null,
          fileId: e.file_id ?? null,
          s3Key: e.s3_key ?? null,
          mediaType: e.media_type ?? null,
        })),
      });
    }

    return {
      client: { name: client?.name ?? "(cliente)" },
      brand,
      brandLogo,
      engagement: {
        name: engagement.name,
        code: engagement.code,
        status: engagement.status,
        startsAt: engagement.starts_at,
        endsAt: engagement.ends_at,
        scope: (engagement.scope ?? []).map((s) => ({
          kind: s.kind,
          value: s.value,
          inScope: s.in_scope,
        })),
      },
      findingCount: findings.length,
      findings,
    };
  },
});

/** Normaliza cor hex p/ o renderer (sem '#', maiúsculas, 6 dígitos). */
function normalizeHex(s?: string): string | undefined {
  const t = (s ?? "").trim().replace(/^#/, "").toUpperCase();
  return /^[0-9A-F]{6}$/.test(t) ? t : undefined;
}

/**
 * Marca dos relatórios do analista (por user_id; portal-ready com
 * organization_id). Lida pela UI interna (rota /api/report-brand, gateada por
 * getInternalUser). Campos vazios → padrão (DEFAULT_BRAND no builder).
 */
export const getReportBrandForBackend = query({
  args: { serviceKey: v.string(), userId: v.string() },
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const row = await ctx.db
      .query("report_brands")
      .withIndex("by_user", (q) => q.eq("user_id", args.userId))
      .first();
    if (!row) return null;
    return {
      name: row.name ?? null,
      wordmark: row.wordmark ?? null,
      tagline: row.tagline ?? null,
      contact: row.contact ?? null,
      docCodePrefix: row.doc_code_prefix ?? null,
      primary: row.primary ?? null,
      accent: row.accent ?? null,
      classification: row.classification ?? null,
      logoS3Key: row.logo_s3_key ?? null,
      logoMediaType: row.logo_media_type ?? null,
      organizationId: row.organization_id ?? null,
      updatedAt: row.updated_at,
    };
  },
});

/**
 * Define (ou limpa, com s3Key vazio) o logo da marca do analista. Separado do
 * upsert de texto para uma gravação de texto NUNCA apagar o logo por engano.
 */
export const setReportBrandLogoForBackend = mutation({
  args: {
    serviceKey: v.string(),
    userId: v.string(),
    s3Key: v.optional(v.string()),
    mediaType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const key = (args.s3Key ?? "").trim();
    const logoFields = {
      logo_s3_key: key === "" ? undefined : key,
      logo_media_type: key === "" ? undefined : (args.mediaType ?? undefined),
      updated_at: Date.now(),
    };
    const existing = await ctx.db
      .query("report_brands")
      .withIndex("by_user", (q) => q.eq("user_id", args.userId))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, logoFields);
      return existing._id;
    }
    return await ctx.db.insert("report_brands", {
      user_id: args.userId,
      ...logoFields,
    });
  },
});

export const upsertReportBrandForBackend = mutation({
  args: {
    serviceKey: v.string(),
    userId: v.string(),
    organizationId: v.optional(v.string()),
    name: v.optional(v.string()),
    wordmark: v.optional(v.string()),
    tagline: v.optional(v.string()),
    contact: v.optional(v.string()),
    docCodePrefix: v.optional(v.string()),
    primary: v.optional(v.string()),
    accent: v.optional(v.string()),
    classification: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const clean = (s?: string) => {
      const t = (s ?? "").trim();
      return t === "" ? undefined : t;
    };
    const fields = {
      user_id: args.userId,
      organization_id: clean(args.organizationId),
      name: clean(args.name),
      wordmark: clean(args.wordmark),
      tagline: clean(args.tagline),
      contact: clean(args.contact),
      doc_code_prefix: clean(args.docCodePrefix),
      primary: normalizeHex(args.primary),
      accent: normalizeHex(args.accent),
      classification: clean(args.classification),
      updated_at: Date.now(),
    };
    const existing = await ctx.db
      .query("report_brands")
      .withIndex("by_user", (q) => q.eq("user_id", args.userId))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, fields);
      return existing._id;
    }
    return await ctx.db.insert("report_brands", fields);
  },
});

/**
 * Saúde do pipeline p/ o watchdog do trigger: quantos relatórios estão presos
 * (queued/rendering há mais de olderThanMs). >0 sem run é sinal de worker mudo.
 * serviceKey-only (rodado por um script no host, sem identidade).
 */
export const countStuckReportsForBackend = query({
  args: { serviceKey: v.string(), olderThanMs: v.number() },
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const cutoff = Date.now() - args.olderThanMs;
    let stuck = 0;
    for (const status of ["queued", "rendering"] as const) {
      const rows = await ctx.db
        .query("reports")
        .withIndex("by_status", (q) => q.eq("status", status))
        .collect();
      for (const r of rows) if (r.updated_at < cutoff) stuck++;
    }
    return stuck;
  },
});

/**
 * Cria a solicitação de relatório (uma linha reports por formato, mesmo
 * report_group_id + version). serviceKey + userId (a rota gateia via
 * getInternalUser e passa o WorkOS user.id, que === engagement.user_id).
 */
export const createReportRequest = mutation({
  args: {
    serviceKey: v.string(),
    userId: v.string(),
    engagementId: v.id("engagements"),
    audience: audienceArg,
    formats: v.array(formatArg),
    generatedBy: v.string(),
  },
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const engagement = await ctx.db.get(args.engagementId);
    if (!engagement || engagement.user_id !== args.userId) {
      throw new ConvexError({ code: "ACCESS_DENIED", message: "Sem acesso" });
    }
    if (args.formats.length === 0) {
      throw new ConvexError({ code: "INVALID", message: "Nenhum formato" });
    }

    // Próxima versão por (engagement, audience), calculada na transação.
    const latest = await ctx.db
      .query("reports")
      .withIndex("by_engagement_audience_version", (q) =>
        q.eq("engagement_id", args.engagementId).eq("audience", args.audience),
      )
      .order("desc")
      .first();
    const version = (latest?.version ?? 0) + 1;

    const reportGroupId = newGroupId();
    const now = Date.now();
    const title = `${engagement.name} — ${args.audience} v${version}`;
    const ids: Id<"reports">[] = [];
    for (const format of args.formats) {
      const id = await ctx.db.insert("reports", {
        report_group_id: reportGroupId,
        user_id: engagement.user_id,
        organization_id: engagement.organization_id,
        client_id: engagement.client_id,
        engagement_id: args.engagementId,
        audience: args.audience,
        format,
        version,
        status: "queued",
        title,
        template_version: "v1",
        generated_by: args.generatedBy,
        created_at: now,
        updated_at: now,
      });
      ids.push(id);
    }
    return { reportGroupId, version, reportIds: ids };
  },
});

/**
 * Parâmetros de um grupo de relatório para REPROCESSAR (serviceKey + userId; a
 * rota gateia por getInternalUser). Também reseta os formatos para "queued".
 */
export const getReportGroupParamsBackend = mutation({
  args: {
    serviceKey: v.string(),
    userId: v.string(),
    reportGroupId: v.string(),
  },
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const rows = await ctx.db
      .query("reports")
      .withIndex("by_group", (q) => q.eq("report_group_id", args.reportGroupId))
      .collect();
    const owned = rows.filter((r) => r.user_id === args.userId);
    if (owned.length === 0) return null;
    const first = owned[0];
    // Reseta para a fila (a task remarca rendering→ready).
    for (const r of owned) {
      await ctx.db.patch(r._id, {
        status: "queued",
        error: undefined,
        updated_at: Date.now(),
      });
    }
    return {
      engagementId: first.engagement_id,
      audience: first.audience,
      version: first.version,
      formats: owned.map((r) => r.format),
      generatedBy: first.generated_by,
    };
  },
});

export const setReportTriggerRunForBackend = mutation({
  args: {
    serviceKey: v.string(),
    reportGroupId: v.string(),
    triggerRunId: v.string(),
  },
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const rows = await ctx.db
      .query("reports")
      .withIndex("by_group", (q) => q.eq("report_group_id", args.reportGroupId))
      .collect();
    for (const r of rows) {
      await ctx.db.patch(r._id, {
        trigger_run_id: args.triggerRunId,
        updated_at: Date.now(),
      });
    }
    return null;
  },
});

async function patchGroupFormat(
  ctx: MutationCtx,
  reportGroupId: string,
  format: string,
  patch: Record<string, unknown>,
) {
  const rows = await ctx.db
    .query("reports")
    .withIndex("by_group", (q) => q.eq("report_group_id", reportGroupId))
    .collect();
  const row = rows.find((r) => r.format === format);
  if (row) await ctx.db.patch(row._id, { ...patch, updated_at: Date.now() });
}

export const markReportRenderingForBackend = mutation({
  args: {
    serviceKey: v.string(),
    reportGroupId: v.string(),
    format: formatArg,
  },
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    await patchGroupFormat(ctx, args.reportGroupId, args.format, {
      status: "rendering",
    });
    return null;
  },
});

export const markReportReadyForBackend = mutation({
  args: {
    serviceKey: v.string(),
    reportGroupId: v.string(),
    format: formatArg,
    s3Key: v.string(),
    sizeBytes: v.number(),
    checksum: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    await patchGroupFormat(ctx, args.reportGroupId, args.format, {
      status: "ready",
      s3_key: args.s3Key,
      size_bytes: args.sizeBytes,
      checksum: args.checksum,
      generated_at: Date.now(),
    });
    return null;
  },
});

export const markReportFailedForBackend = mutation({
  args: {
    serviceKey: v.string(),
    reportGroupId: v.string(),
    format: formatArg,
    error: v.string(),
  },
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    await patchGroupFormat(ctx, args.reportGroupId, args.format, {
      status: "failed",
      error: args.error.slice(0, 500),
    });
    return null;
  },
});

/** Metadados de um relatório para download (identity + posse). */
export const getReportForDownload = query({
  args: { reportId: v.id("reports") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const r = await ctx.db.get(args.reportId);
    if (!r || r.user_id !== identity.subject) return null;
    return {
      s3Key: r.s3_key ?? null,
      status: r.status,
      format: r.format,
      audience: r.audience,
      version: r.version,
      title: r.title,
    };
  },
});

/**
 * Metadados p/ download pela ROTA-PROXY autenticada (serviceKey + userId).
 * A rota Next gateia via getInternalUser e passa o WorkOS user.id (=== user_id).
 * Retorna também client/engagement/org para a trilha de auditoria.
 */
export const getReportForDownloadBackend = query({
  args: {
    serviceKey: v.string(),
    userId: v.string(),
    reportId: v.id("reports"),
  },
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const r = await ctx.db.get(args.reportId);
    if (!r || r.user_id !== args.userId) return null;
    return {
      s3Key: r.s3_key ?? null,
      status: r.status,
      format: r.format,
      audience: r.audience,
      version: r.version,
      title: r.title,
      clientId: r.client_id,
      engagementId: r.engagement_id,
      organizationId: r.organization_id ?? null,
    };
  },
});

/**
 * Conteúdo do relatório para PRÉVIA na tela (não gera arquivo): meta + KPIs +
 * achados não-descartados (ordem de severidade) com cadeia de evidência e
 * marcação de quais evidências são imagem (servidas por /api/evidence/[id]/image).
 * Keyed por engajamento — o conteúdo é o mesmo p/ docx/pptx/pdf.
 */
export const getReportPreviewForBackend = query({
  args: {
    serviceKey: v.string(),
    userId: v.string(),
    engagementId: v.id("engagements"),
  },
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const engagement = await ctx.db.get(args.engagementId);
    if (!engagement || engagement.user_id !== args.userId) {
      throw new ConvexError({ code: "ACCESS_DENIED", message: "Sem acesso" });
    }
    const client = await ctx.db.get(engagement.client_id);
    const raw = (
      await ctx.db
        .query("findings")
        .withIndex("by_engagement_and_updated", (q) =>
          q.eq("engagement_id", args.engagementId),
        )
        .collect()
    ).filter((f) => f.status !== "dismissed");
    const sevRank: Record<string, number> = {
      critical: 0,
      high: 1,
      medium: 2,
      low: 3,
      info: 4,
    };
    raw.sort((a, b) => (sevRank[a.severity] ?? 9) - (sevRank[b.severity] ?? 9));
    const bySeverity: Record<string, number> = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
    };
    let maxCvss = 0;
    const findings = [];
    for (const f of raw) {
      bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;
      if (typeof f.cvss_score === "number" && f.cvss_score > maxCvss)
        maxCvss = f.cvss_score;
      const evRaw = await ctx.db
        .query("evidence")
        .withIndex("by_finding_and_captured", (q) => q.eq("finding_id", f._id))
        .order("desc")
        .take(EVIDENCE_PER_FINDING);
      const ev = evRaw
        .slice()
        .sort(
          (a, b) =>
            (a.step_index ?? Number.MAX_SAFE_INTEGER) -
              (b.step_index ?? Number.MAX_SAFE_INTEGER) ||
            a.captured_at - b.captured_at,
        );
      findings.push({
        ref: f.finding_id,
        title: f.title,
        severity: f.severity,
        affectedAsset: f.affected_asset,
        weaknessClass: f.weakness_class,
        cvssScore: f.cvss_score ?? null,
        cvssVector: f.cvss_vector ?? null,
        cwe: f.cwe ?? null,
        narrative: f.narrative ?? null,
        description: f.description ?? null,
        impact: f.impact ?? null,
        remediation: f.remediation ?? null,
        status: f.status,
        evidence: ev.map((e) => ({
          evidenceId: e._id,
          sourceType: e.source_type,
          label: e.label ?? null,
          stepIndex: e.step_index ?? null,
          toolName: e.tool_name ?? null,
          command: e.command ?? null,
          snippet: e.snippet ?? null,
          resultSummary: e.result_summary ?? null,
          isImage: !!(e.file_id && (e.media_type ?? "").startsWith("image/")),
        })),
      });
    }
    return {
      client: client?.name ?? "(cliente)",
      engagement: engagement.name,
      total: raw.length,
      bySeverity,
      maxCvss,
      findings,
    };
  },
});

/** Lista reativa dos relatórios do engajamento (identity + posse) — p/ a UI. */
export const listReportsForEngagement = query({
  args: { engagementId: v.id("engagements") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const engagement = await ctx.db.get(args.engagementId);
    if (!engagement || engagement.user_id !== identity.subject) return [];
    return await ctx.db
      .query("reports")
      .withIndex("by_engagement", (q) =>
        q.eq("engagement_id", args.engagementId),
      )
      .order("desc")
      .take(120);
  },
});

/** s3_keys de um grupo de relatório (identity + posse) — p/ a action limpar o S3. */
export const getReportGroupForDeletion = query({
  args: { reportGroupId: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const rows = await ctx.db
      .query("reports")
      .withIndex("by_group", (q) => q.eq("report_group_id", args.reportGroupId))
      .collect();
    return rows
      .filter((r) => r.user_id === identity.subject)
      .map((r) => ({ id: r._id, s3Key: r.s3_key ?? null }));
  },
});

/** Remove todas as linhas de um grupo de relatório (identity + posse). */
export const deleteReportGroup = mutation({
  args: { reportGroupId: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError({
        code: "UNAUTHORIZED",
        message: "Não autenticado",
      });
    }
    const rows = await ctx.db
      .query("reports")
      .withIndex("by_group", (q) => q.eq("report_group_id", args.reportGroupId))
      .collect();
    let deleted = 0;
    for (const r of rows) {
      if (r.user_id === identity.subject) {
        await ctx.db.delete(r._id);
        deleted += 1;
      }
    }
    return { deleted };
  },
});

/**
 * Saúde da geração de relatórios para o /admin (serviceKey). Conta por status
 * (índice by_status), detecta "presos" (queued/rendering há mais de stuckMs — o
 * sinal do worker do trigger mudo, ver watchdog) e lista presos + falhas
 * recentes com nome do cliente/engajamento resolvidos (bounded). nowMs vem da
 * rota (Node) para não usar Date.now() na query.
 */
const HEALTH_READY_CAP = 3000;
const HEALTH_STATUS_CAP = 1000;
const STUCK_LIST_CAP = 50;
const FAILED_LIST_CAP = 25;
const HEALTH_ERR_MAX = 240;

export const getSystemHealthForBackend = query({
  args: { serviceKey: v.string(), nowMs: v.number(), stuckMs: v.number() },
  returns: v.object({
    reports: v.object({
      ready: v.number(),
      readyCapped: v.boolean(),
      queued: v.number(),
      rendering: v.number(),
      failed: v.number(),
      stuck: v.number(),
    }),
    stuckList: v.array(
      v.object({
        id: v.string(),
        audience: v.string(),
        format: v.string(),
        version: v.number(),
        engagementName: v.string(),
        clientName: v.string(),
        createdAt: v.number(),
        updatedAt: v.number(),
        hasRun: v.boolean(),
      }),
    ),
    recentFailed: v.array(
      v.object({
        id: v.string(),
        audience: v.string(),
        format: v.string(),
        version: v.number(),
        engagementName: v.string(),
        clientName: v.string(),
        updatedAt: v.number(),
        error: v.string(),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const cutoff = args.nowMs - args.stuckMs;

    const byStatus = async (
      status: "ready" | "queued" | "rendering" | "failed",
      cap: number,
    ) =>
      await ctx.db
        .query("reports")
        .withIndex("by_status", (q) => q.eq("status", status))
        .take(cap);

    const readyRows = await byStatus("ready", HEALTH_READY_CAP);
    const queuedRows = await byStatus("queued", HEALTH_STATUS_CAP);
    const renderingRows = await byStatus("rendering", HEALTH_STATUS_CAP);
    const failedRows = await byStatus("failed", HEALTH_STATUS_CAP);

    const engCache = new Map<string, string>();
    const cliCache = new Map<string, string>();
    const resolveNames = async (
      engId: Id<"engagements">,
      cliId: Id<"clients">,
    ): Promise<{ engagementName: string; clientName: string }> => {
      let engagementName = engCache.get(engId);
      if (engagementName === undefined) {
        const e = await ctx.db.get(engId);
        engagementName = e?.name ?? "(engajamento removido)";
        engCache.set(engId, engagementName);
      }
      let clientName = cliCache.get(cliId);
      if (clientName === undefined) {
        const c = await ctx.db.get(cliId);
        clientName = c?.name ?? "(cliente removido)";
        cliCache.set(cliId, clientName);
      }
      return { engagementName, clientName };
    };

    const stuckSrc = [...queuedRows, ...renderingRows]
      .filter((r) => r.updated_at < cutoff)
      .sort((a, b) => a.updated_at - b.updated_at);

    const stuckList = [];
    for (const r of stuckSrc.slice(0, STUCK_LIST_CAP)) {
      const { engagementName, clientName } = await resolveNames(
        r.engagement_id,
        r.client_id,
      );
      stuckList.push({
        id: r._id,
        audience: r.audience,
        format: r.format,
        version: r.version,
        engagementName,
        clientName,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        hasRun: typeof r.trigger_run_id === "string",
      });
    }

    const failedSorted = [...failedRows].sort(
      (a, b) => b.updated_at - a.updated_at,
    );
    const recentFailed = [];
    for (const r of failedSorted.slice(0, FAILED_LIST_CAP)) {
      const { engagementName, clientName } = await resolveNames(
        r.engagement_id,
        r.client_id,
      );
      recentFailed.push({
        id: r._id,
        audience: r.audience,
        format: r.format,
        version: r.version,
        engagementName,
        clientName,
        updatedAt: r.updated_at,
        error: (r.error ?? "").slice(0, HEALTH_ERR_MAX),
      });
    }

    return {
      reports: {
        ready: readyRows.length,
        readyCapped: readyRows.length === HEALTH_READY_CAP,
        queued: queuedRows.length,
        rendering: renderingRows.length,
        failed: failedRows.length,
        stuck: stuckSrc.length,
      },
      stuckList,
      recentFailed,
    };
  },
});
