import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { validateServiceKey } from "./lib/utils";

/**
 * security_audit_log — trilha de auditoria DURÁVEL (não best-effort) do plano de
 * dados de segurança (relatórios/evidência). Só INSERT (imutável); sem
 * update/delete. Escrita pelas rotas Next (serviceKey) ANTES de servir bytes:
 * se a gravação falhar, a rota deve responder 503 e NUNCA entregar o arquivo.
 *
 * v2 (portal): export para S3 Object Lock (WORM) + eventos de membership.
 * Ver [[stratihawkeye-security-program]] / plano.
 */

const eventTypeArg = v.union(
  v.literal("report.generated"),
  v.literal("report.viewed"),
  v.literal("report.downloaded"),
  v.literal("evidence.viewed"),
  v.literal("evidence.downloaded"),
  v.literal("artifact.url_issued"),
  v.literal("membership.granted"),
  v.literal("membership.revoked"),
  v.literal("engagement.created"),
  v.literal("access.denied"),
);
const actorKindArg = v.union(
  v.literal("internal"),
  v.literal("client"),
  v.literal("system"),
);
const outcomeArg = v.union(
  v.literal("success"),
  v.literal("denied"),
  v.literal("error"),
);

export const recordSecurityEventForBackend = mutation({
  args: {
    serviceKey: v.string(),
    eventType: eventTypeArg,
    actorUserId: v.optional(v.string()),
    actorEmail: v.optional(v.string()),
    actorKind: actorKindArg,
    organizationId: v.optional(v.string()),
    clientId: v.optional(v.id("clients")),
    engagementId: v.optional(v.id("engagements")),
    targetType: v.optional(v.string()),
    targetId: v.optional(v.string()),
    ip: v.optional(v.string()),
    userAgent: v.optional(v.string()),
    requestId: v.optional(v.string()),
    outcome: outcomeArg,
    detail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const id = await ctx.db.insert("security_audit_log", {
      event_type: args.eventType,
      actor_user_id: args.actorUserId,
      actor_email: args.actorEmail,
      actor_kind: args.actorKind,
      organization_id: args.organizationId,
      client_id: args.clientId,
      engagement_id: args.engagementId,
      target_type: args.targetType,
      target_id: args.targetId,
      ip: args.ip,
      user_agent: args.userAgent?.slice(0, 500),
      request_id: args.requestId,
      outcome: args.outcome,
      detail: args.detail?.slice(0, 1000),
      created_at: Date.now(),
    });
    return { id };
  },
});
