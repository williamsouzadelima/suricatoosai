import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { validateServiceKey } from "./lib/utils";
import type { Id } from "./_generated/dataModel";

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
  v.literal("portal.enabled"),
  v.literal("portal.disabled"),
  v.literal("threat.detected"),
  v.literal("enumeration.detected"),
  v.literal("anomaly.detected"),
  v.literal("ip.blocked"),
  v.literal("ip.unblocked"),
  v.literal("ioc.added"),
  v.literal("ioc.removed"),
  v.literal("user.autoblocked"),
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

/**
 * Leitura do security_audit_log para o /admin (serviceKey). Filtra por
 * event_type (índice by_event_created) ou mostra os mais recentes de todos os
 * tipos (índice de sistema by_creation_time). Resolve nome do cliente dos itens
 * listados (bounded/memo). Só leitura — a tabela é imutável.
 */
const AUDIT_READ_CAP = 200;
const AUDIT_EVENT_TYPES = [
  "report.generated",
  "report.viewed",
  "report.downloaded",
  "evidence.viewed",
  "evidence.downloaded",
  "artifact.url_issued",
  "membership.granted",
  "membership.revoked",
  "engagement.created",
  "access.denied",
  "portal.enabled",
  "portal.disabled",
  "threat.detected",
  "enumeration.detected",
  "anomaly.detected",
  "ip.blocked",
  "ip.unblocked",
  "ioc.added",
  "ioc.removed",
  "user.autoblocked",
] as const;

export const getSecurityAuditForBackend = query({
  args: {
    serviceKey: v.string(),
    eventType: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    rows: v.array(
      v.object({
        id: v.string(),
        eventType: v.string(),
        actorEmail: v.union(v.string(), v.null()),
        actorKind: v.string(),
        clientName: v.union(v.string(), v.null()),
        targetType: v.union(v.string(), v.null()),
        targetId: v.union(v.string(), v.null()),
        outcome: v.string(),
        detail: v.union(v.string(), v.null()),
        ip: v.union(v.string(), v.null()),
        createdAt: v.number(),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const limit = Math.min(Math.max(args.limit ?? AUDIT_READ_CAP, 1), 500);
    const known = (AUDIT_EVENT_TYPES as readonly string[]).includes(
      args.eventType ?? "",
    );

    const docs = known
      ? await ctx.db
          .query("security_audit_log")
          .withIndex("by_event_created", (q) =>
            q.eq(
              "event_type",
              args.eventType as (typeof AUDIT_EVENT_TYPES)[number],
            ),
          )
          .order("desc")
          .take(limit)
      : await ctx.db.query("security_audit_log").order("desc").take(limit);

    const cliCache = new Map<string, string>();
    const rows = [];
    for (const d of docs) {
      let clientName: string | null = null;
      if (d.client_id) {
        const key = d.client_id as string;
        let name = cliCache.get(key);
        if (name === undefined) {
          const c = await ctx.db.get(d.client_id as Id<"clients">);
          name = c?.name ?? "(cliente removido)";
          cliCache.set(key, name);
        }
        clientName = name;
      }
      rows.push({
        id: d._id,
        eventType: d.event_type,
        actorEmail: d.actor_email ?? null,
        actorKind: d.actor_kind,
        clientName,
        targetType: d.target_type ?? null,
        targetId: d.target_id ?? null,
        outcome: d.outcome,
        detail: d.detail ?? null,
        ip: d.ip ?? null,
        createdAt: d.created_at,
      });
    }
    return { rows };
  },
});
