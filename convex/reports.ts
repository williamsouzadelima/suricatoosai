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
