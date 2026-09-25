import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { validateServiceKey } from "./lib/utils";

/**
 * Achados + evidências da feature de relatórios.
 *
 * Captura = serviceKey (agente), grava SEMPRE em status "draft"/"in_review".
 * Curadoria (submit/approve/publish/dismiss/reopen/update) = identity-only
 * (ctx.auth) + posse (finding.user_id === identity.subject) — é isto que
 * garante que o agente NUNCA publica sozinho (ele não tem essas mutations).
 * Fingerprint de dedup é calculado no bridge Node e passado pronto (o runtime
 * V8 do Convex não tem node:crypto). Ver lib/db/findings.ts.
 */

const severityArg = v.union(
  v.literal("info"),
  v.literal("low"),
  v.literal("medium"),
  v.literal("high"),
  v.literal("critical"),
);
const originArg = v.union(
  v.literal("agent"),
  v.literal("subagent"),
  v.literal("analyst"),
);
const confidenceArg = v.union(
  v.literal("low"),
  v.literal("medium"),
  v.literal("high"),
);
const verdictArg = v.union(
  v.literal("confirmed"),
  v.literal("rejected"),
  v.literal("inconclusive"),
);
const statusArg = v.union(
  v.literal("draft"),
  v.literal("in_review"),
  v.literal("approved"),
  v.literal("published"),
  v.literal("dismissed"),
);
const evidenceSourceArg = v.union(
  v.literal("tool_output"),
  v.literal("command"),
  v.literal("file"),
  v.literal("http"),
  v.literal("note"),
  v.literal("manual"),
);
const evidenceItemArg = v.object({
  source_type: evidenceSourceArg,
  label: v.optional(v.string()),
  snippet: v.optional(v.string()),
  file_id: v.optional(v.id("files")),
  s3_key: v.optional(v.string()),
  sandbox_path: v.optional(v.string()),
  chat_id: v.optional(v.string()),
  message_id: v.optional(v.string()),
  tool_call_id: v.optional(v.string()),
  subagent_id: v.optional(v.string()),
  media_type: v.optional(v.string()),
  step_index: v.optional(v.number()),
  tool_name: v.optional(v.string()),
  command: v.optional(v.string()),
  result_summary: v.optional(v.string()),
});

const MAX_SNIPPET_CHARS = 8000; // ~ mantém a linha bem abaixo do teto de 1MB
const MAX_NARRATIVE_CHARS = 20000; // description/impact/remediation
const MAX_REPRO_STEPS = 50;
const MAX_REPRO_STEP_CHARS = 4000;

function clampText(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return value.length > MAX_NARRATIVE_CHARS
    ? value.slice(0, MAX_NARRATIVE_CHARS)
    : value;
}

function clampSteps(steps: string[] | undefined): string[] | undefined {
  if (steps === undefined) return undefined;
  return steps
    .slice(0, MAX_REPRO_STEPS)
    .map((s) =>
      s.length > MAX_REPRO_STEP_CHARS ? s.slice(0, MAX_REPRO_STEP_CHARS) : s,
    );
}

function generateFindingId(): string {
  return `F-${Math.random().toString(36).substring(2, 7)}`;
}

function clampSnippet(snippet: string | undefined): string | undefined {
  if (snippet === undefined) return undefined;
  return snippet.length > MAX_SNIPPET_CHARS
    ? snippet.slice(0, MAX_SNIPPET_CHARS)
    : snippet;
}

async function insertEvidence(
  ctx: MutationCtx,
  finding: Doc<"findings">,
  item: {
    source_type: Doc<"evidence">["source_type"];
    label?: string;
    snippet?: string;
    file_id?: Id<"files">;
    s3_key?: string;
    sandbox_path?: string;
    chat_id?: string;
    message_id?: string;
    tool_call_id?: string;
    subagent_id?: string;
    media_type?: string;
    step_index?: number;
    tool_name?: string;
    command?: string;
    result_summary?: string;
  },
): Promise<void> {
  const now = Date.now();
  await ctx.db.insert("evidence", {
    user_id: finding.user_id,
    organization_id: finding.organization_id,
    client_id: finding.client_id,
    engagement_id: finding.engagement_id,
    finding_id: finding._id,
    source_type: item.source_type,
    chat_id: item.chat_id,
    message_id: item.message_id,
    tool_call_id: item.tool_call_id,
    subagent_id: item.subagent_id,
    file_id: item.file_id,
    s3_key: item.s3_key,
    sandbox_path: item.sandbox_path,
    label: item.label,
    snippet: clampSnippet(item.snippet),
    media_type: item.media_type,
    step_index: item.step_index,
    tool_name: item.tool_name,
    command: clampText(item.command),
    result_summary: clampText(item.result_summary),
    captured_at: now,
    created_at: now,
  });
}

/** Evita reinserir evidência idêntica ao mesclar recapturas (contém acúmulo). */
async function evidenceAlreadyPresent(
  ctx: MutationCtx,
  findingId: Id<"findings">,
  item: {
    source_type: Doc<"evidence">["source_type"];
    tool_call_id?: string;
    message_id?: string;
    label?: string;
  },
): Promise<boolean> {
  const recent = await ctx.db
    .query("evidence")
    .withIndex("by_finding_and_captured", (q) => q.eq("finding_id", findingId))
    .order("desc")
    .take(500);
  return recent.some(
    (e) =>
      e.source_type === item.source_type &&
      e.tool_call_id === item.tool_call_id &&
      e.message_id === item.message_id &&
      e.label === item.label,
  );
}

async function requireOwnedFinding(
  ctx: MutationCtx,
  findingId: Id<"findings">,
): Promise<{ subject: string; finding: Doc<"findings"> }> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new ConvexError({ code: "UNAUTHORIZED", message: "Unauthorized" });
  }
  const finding = await ctx.db.get(findingId);
  if (!finding || finding.user_id !== identity.subject) {
    throw new ConvexError({ code: "ACCESS_DENIED", message: "Sem acesso" });
  }
  return { subject: identity.subject, finding };
}

/**
 * Captura de achado pelo agente (serviceKey). Dedup por engajamento+fingerprint:
 * se já existe um achado NÃO aprovado com o mesmo fingerprint, só anexa evidência
 * e completa campos vazios; caso contrário cria um novo em "draft".
 */
export const captureFindingForBackend = mutation({
  args: {
    serviceKey: v.string(),
    userId: v.string(),
    engagementId: v.id("engagements"),
    dedupFingerprint: v.string(),
    origin: originArg,
    title: v.string(),
    affectedAsset: v.string(),
    weaknessClass: v.string(),
    severity: severityArg,
    description: v.optional(v.string()),
    impact: v.optional(v.string()),
    remediation: v.optional(v.string()),
    reproductionSteps: v.optional(v.array(v.string())),
    narrative: v.optional(v.string()),
    cwe: v.optional(v.string()),
    cvssVector: v.optional(v.string()),
    cvssScore: v.optional(v.number()),
    confidence: v.optional(confidenceArg),
    verdict: v.optional(verdictArg),
    sourceChatId: v.optional(v.string()),
    sourceMessageId: v.optional(v.string()),
    sourceToolCallId: v.optional(v.string()),
    sourceSubagentId: v.optional(v.string()),
    evidence: v.optional(v.array(evidenceItemArg)),
  },
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    if (!args.title.trim() || !args.affectedAsset.trim()) {
      return { success: false, error: "Título e ativo são obrigatórios" };
    }

    // Fonte da verdade da tenancy é o engajamento: exige posse do userId e
    // deriva client_id/organization_id DELE (nunca de args separados, que
    // poderiam divergir ou apontar para outro tenant).
    const engagement = await ctx.db.get(args.engagementId);
    if (!engagement || engagement.user_id !== args.userId) {
      return { success: false, error: "Engajamento inexistente ou sem acesso" };
    }
    const clientId = engagement.client_id;
    const organizationId = engagement.organization_id;

    const dupes = await ctx.db
      .query("findings")
      .withIndex("by_engagement_and_fingerprint", (q) =>
        q
          .eq("engagement_id", args.engagementId)
          .eq("dedup_fingerprint", args.dedupFingerprint),
      )
      .collect();
    const mergeable = dupes.find(
      (f) =>
        (f.status === "draft" || f.status === "in_review") &&
        f.user_id === args.userId,
    );

    if (mergeable) {
      // Completa apenas campos ainda vazios; não sobrescreve curadoria.
      const patch: Record<string, unknown> = { updated_at: Date.now() };
      if (!mergeable.description && args.description)
        patch.description = clampText(args.description);
      if (!mergeable.impact && args.impact)
        patch.impact = clampText(args.impact);
      if (!mergeable.remediation && args.remediation)
        patch.remediation = clampText(args.remediation);
      if (!mergeable.narrative && args.narrative)
        patch.narrative = clampText(args.narrative);
      if (!mergeable.cwe && args.cwe) patch.cwe = args.cwe;
      if (!mergeable.cvss_vector && args.cvssVector)
        patch.cvss_vector = args.cvssVector;
      await ctx.db.patch(mergeable._id, patch);
      for (const item of args.evidence ?? []) {
        if (!(await evidenceAlreadyPresent(ctx, mergeable._id, item))) {
          await insertEvidence(ctx, mergeable, item);
        }
      }
      return {
        success: true,
        merged: true,
        findingId: mergeable._id,
        finding_id: mergeable.finding_id,
      };
    }

    // Gera finding_id único (com checagem de colisão).
    let findingRef: string | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = generateFindingId();
      const existing = await ctx.db
        .query("findings")
        .withIndex("by_finding_id", (q) => q.eq("finding_id", candidate))
        .first();
      if (!existing) {
        findingRef = candidate;
        break;
      }
    }
    if (!findingRef) {
      return { success: false, error: "Falha ao gerar finding_id" };
    }

    const now = Date.now();
    const findingId = await ctx.db.insert("findings", {
      user_id: args.userId,
      organization_id: organizationId,
      client_id: clientId,
      engagement_id: args.engagementId,
      finding_id: findingRef,
      origin: args.origin,
      source_chat_id: args.sourceChatId,
      source_message_id: args.sourceMessageId,
      source_tool_call_id: args.sourceToolCallId,
      source_subagent_id: args.sourceSubagentId,
      title: args.title.trim(),
      affected_asset: args.affectedAsset.trim(),
      weakness_class: args.weaknessClass.trim(),
      cwe: args.cwe,
      description: clampText(args.description),
      impact: clampText(args.impact),
      remediation: clampText(args.remediation),
      reproduction_steps: clampSteps(args.reproductionSteps),
      narrative: clampText(args.narrative),
      severity: args.severity,
      cvss_vector: args.cvssVector,
      cvss_score: args.cvssScore,
      verdict: args.verdict,
      confidence: args.confidence,
      status: "draft",
      dedup_fingerprint: args.dedupFingerprint,
      created_by: args.origin === "analyst" ? args.userId : "agent",
      tags: [],
      created_at: now,
      updated_at: now,
    });

    const finding = await ctx.db.get(findingId);
    if (finding) {
      for (const item of args.evidence ?? []) {
        await insertEvidence(ctx, finding, item);
      }
    }
    return { success: true, merged: false, findingId, finding_id: findingRef };
  },
});

// ── Curadoria (identity-only) ─────────────────────────────────────────────

export const submitForReview = mutation({
  args: { findingId: v.id("findings") },
  handler: async (ctx, args) => {
    const { finding } = await requireOwnedFinding(ctx, args.findingId);
    if (finding.status !== "draft") {
      throw new ConvexError({
        code: "INVALID",
        message: "Não está em rascunho",
      });
    }
    await ctx.db.patch(finding._id, {
      status: "in_review",
      updated_at: Date.now(),
    });
    return null;
  },
});

export const approveFinding = mutation({
  args: { findingId: v.id("findings") },
  handler: async (ctx, args) => {
    const { subject, finding } = await requireOwnedFinding(ctx, args.findingId);
    if (finding.status !== "in_review") {
      throw new ConvexError({
        code: "INVALID",
        message: "Não está em revisão",
      });
    }
    const evidenceCount = (
      await ctx.db
        .query("evidence")
        .withIndex("by_finding_and_captured", (q) =>
          q.eq("finding_id", finding._id),
        )
        .take(1)
    ).length;
    if (evidenceCount === 0) {
      throw new ConvexError({
        code: "INVALID",
        message: "Aprovar exige ao menos uma evidência",
      });
    }
    await ctx.db.patch(finding._id, {
      status: "approved",
      approved_by: subject,
      approved_at: Date.now(),
      updated_at: Date.now(),
    });
    return null;
  },
});

/**
 * Aprova EM MASSA os achados em rascunho/revisão do engajamento que têm ao menos
 * uma evidência (para entrarem no relatório). Identity + posse. Pula os sem
 * evidência. Aprovar é identity-only (analista decide).
 */
export const approveAllForEngagement = mutation({
  args: { engagementId: v.id("engagements") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError({
        code: "UNAUTHORIZED",
        message: "Não autenticado",
      });
    }
    const engagement = await ctx.db.get(args.engagementId);
    if (!engagement || engagement.user_id !== identity.subject) {
      throw new ConvexError({ code: "ACCESS_DENIED", message: "Sem acesso" });
    }
    const findings = await ctx.db
      .query("findings")
      .withIndex("by_engagement_and_updated", (q) =>
        q.eq("engagement_id", args.engagementId),
      )
      .collect();
    let approved = 0;
    let skipped = 0;
    for (const f of findings) {
      if (
        f.user_id !== identity.subject ||
        (f.status !== "draft" && f.status !== "in_review")
      ) {
        continue;
      }
      const hasEv = (
        await ctx.db
          .query("evidence")
          .withIndex("by_finding_and_captured", (q) =>
            q.eq("finding_id", f._id),
          )
          .take(1)
      ).length;
      if (hasEv === 0) {
        skipped += 1;
        continue;
      }
      await ctx.db.patch(f._id, {
        status: "approved",
        approved_by: identity.subject,
        approved_at: Date.now(),
        updated_at: Date.now(),
      });
      approved += 1;
    }
    return { approved, skipped };
  },
});

export const publishFinding = mutation({
  args: { findingId: v.id("findings") },
  handler: async (ctx, args) => {
    const { finding } = await requireOwnedFinding(ctx, args.findingId);
    if (finding.status !== "approved") {
      throw new ConvexError({ code: "INVALID", message: "Não está aprovado" });
    }
    await ctx.db.patch(finding._id, {
      status: "published",
      published_at: Date.now(),
      updated_at: Date.now(),
    });
    return null;
  },
});

export const dismissFinding = mutation({
  args: { findingId: v.id("findings"), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { finding } = await requireOwnedFinding(ctx, args.findingId);
    await ctx.db.patch(finding._id, {
      status: "dismissed",
      dismiss_reason: args.reason,
      approved_by: undefined,
      approved_at: undefined,
      published_at: undefined,
      updated_at: Date.now(),
    });
    return null;
  },
});

export const reopenFinding = mutation({
  args: { findingId: v.id("findings") },
  handler: async (ctx, args) => {
    const { finding } = await requireOwnedFinding(ctx, args.findingId);
    await ctx.db.patch(finding._id, {
      status: "in_review",
      dismiss_reason: undefined,
      approved_by: undefined,
      approved_at: undefined,
      published_at: undefined,
      updated_at: Date.now(),
    });
    return null;
  },
});

export const updateFinding = mutation({
  args: {
    findingId: v.id("findings"),
    title: v.optional(v.string()),
    affectedAsset: v.optional(v.string()),
    weaknessClass: v.optional(v.string()),
    severity: v.optional(severityArg),
    description: v.optional(v.string()),
    impact: v.optional(v.string()),
    remediation: v.optional(v.string()),
    reproductionSteps: v.optional(v.array(v.string())),
    narrative: v.optional(v.string()),
    cwe: v.optional(v.string()),
    cvssVector: v.optional(v.string()),
    cvssScore: v.optional(v.number()),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const { finding } = await requireOwnedFinding(ctx, args.findingId);
    if (finding.status === "dismissed") {
      throw new ConvexError({
        code: "INVALID",
        message: "Reabra antes de editar",
      });
    }
    const patch: Record<string, unknown> = { updated_at: Date.now() };
    if (args.title !== undefined) patch.title = args.title.trim();
    if (args.affectedAsset !== undefined)
      patch.affected_asset = args.affectedAsset.trim();
    if (args.weaknessClass !== undefined)
      patch.weakness_class = args.weaknessClass.trim();
    if (args.severity !== undefined) patch.severity = args.severity;
    if (args.description !== undefined) patch.description = args.description;
    if (args.impact !== undefined) patch.impact = args.impact;
    if (args.remediation !== undefined) patch.remediation = args.remediation;
    if (args.narrative !== undefined) patch.narrative = args.narrative;
    if (args.reproductionSteps !== undefined)
      patch.reproduction_steps = args.reproductionSteps;
    if (args.cwe !== undefined) patch.cwe = args.cwe;
    if (args.cvssVector !== undefined) patch.cvss_vector = args.cvssVector;
    if (args.cvssScore !== undefined) patch.cvss_score = args.cvssScore;
    if (args.tags !== undefined) patch.tags = args.tags;
    // Editar um achado já aprovado o devolve para revisão (audit-safe).
    if (finding.status === "approved" || finding.status === "published") {
      patch.status = "in_review";
      patch.approved_by = undefined;
      patch.approved_at = undefined;
      patch.published_at = undefined;
    }
    await ctx.db.patch(finding._id, patch);
    return null;
  },
});

export const addEvidenceManual = mutation({
  args: { findingId: v.id("findings"), item: evidenceItemArg },
  handler: async (ctx, args) => {
    const { finding } = await requireOwnedFinding(ctx, args.findingId);
    await insertEvidence(ctx, finding, args.item);
    return null;
  },
});

// ── Leituras reativas (identity + posse) — alimentam a visão ao vivo ───────

export const listFindingsForEngagement = query({
  args: {
    engagementId: v.id("engagements"),
    status: v.optional(statusArg),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const engagement = await ctx.db.get(args.engagementId);
    if (!engagement || engagement.user_id !== identity.subject) return [];
    if (args.status) {
      return await ctx.db
        .query("findings")
        .withIndex("by_engagement_and_status", (q) =>
          q.eq("engagement_id", args.engagementId).eq("status", args.status!),
        )
        .order("desc")
        .collect();
    }
    return await ctx.db
      .query("findings")
      .withIndex("by_engagement_and_updated", (q) =>
        q.eq("engagement_id", args.engagementId),
      )
      .order("desc")
      .collect();
  },
});

export const listEvidenceForFinding = query({
  args: { findingId: v.id("findings"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const finding = await ctx.db.get(args.findingId);
    if (!finding || finding.user_id !== identity.subject) return [];
    return await ctx.db
      .query("evidence")
      .withIndex("by_finding_and_captured", (q) =>
        q.eq("finding_id", args.findingId),
      )
      .order("desc")
      .take(Math.min(args.limit ?? 200, 500));
  },
});

/**
 * Metadados de uma evidência em arquivo para a ROTA de imagem (serviceKey +
 * userId; a rota gateia por getInternalUser). Devolve s3_key + media_type se a
 * evidência pertence ao usuário e é um arquivo.
 */
export const getEvidenceFileForBackend = query({
  args: {
    serviceKey: v.string(),
    userId: v.string(),
    evidenceId: v.id("evidence"),
  },
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const ev = await ctx.db.get(args.evidenceId);
    if (!ev || ev.user_id !== args.userId) return null;
    if (!ev.s3_key) return null;
    return { s3Key: ev.s3_key, mediaType: ev.media_type ?? null };
  },
});

/** Feed cronológico crescente de evidência do engajamento (visão ao vivo). */
export const streamEngagementEvidence = query({
  args: {
    engagementId: v.id("engagements"),
    sinceMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const engagement = await ctx.db.get(args.engagementId);
    if (!engagement || engagement.user_id !== identity.subject) return [];
    return await ctx.db
      .query("evidence")
      .withIndex("by_engagement_and_captured", (q) =>
        args.sinceMs !== undefined
          ? q
              .eq("engagement_id", args.engagementId)
              .gte("captured_at", args.sinceMs)
          : q.eq("engagement_id", args.engagementId),
      )
      .order("desc")
      .take(200);
  },
});
