import { mutation, query, internalAction } from "./_generated/server";
import { v } from "convex/values";
import { internal, api } from "./_generated/api";
import { validateServiceKey } from "./lib/utils";
import type { Id } from "./_generated/dataModel";

/**
 * Camada de segurança da APLICAÇÃO (serviceKey; rotas Node gateiam por
 * getSuperadminUser). Blocklist de IP/IoC (fonte da verdade durável) + config.
 * A borda (proxy.ts) mantém um cache quente lido por getEdgeBlocklistForBackend.
 * GUARDRAILS: safe-list nunca é bloqueada; kill-switch desliga tudo; auto-block
 * tem TTL; enforcement na borda FALHA ABERTO. Ver [[suricatoosai-portal-cliente]].
 */

const SETTINGS_KEY = "global";

const DEFAULT_SETTINGS = {
  enforcement_mode: "shadow" as const,
  auto_block_enabled: false,
  auto_suspend_users: false,
  kill_switch: false,
  req_burst_window_s: 60,
  req_burst_max: 600,
  deny_burst_max: 40,
  path_scan_distinct_max: 25,
  auto_block_ttl_s: 3600,
  safelist_ips: [] as string[],
  safelist_user_ids: [] as string[],
};

const BLOCKLIST_CAP = 2000;

/**
 * Snapshot para o cache da borda: IPs ativos (type ip, não expirados) + safelist
 * + kill-switch. Chamado pelo proxy.ts (fire-and-forget, cacheado ~30s).
 */
export const getEdgeBlocklistForBackend = query({
  args: { serviceKey: v.string() },
  returns: v.object({
    blocked: v.array(v.string()),
    safelist: v.array(v.string()),
    killSwitch: v.boolean(),
    mode: v.string(),
    autoBlock: v.boolean(),
    reqWindowS: v.number(),
    reqMax: v.number(),
    denyMax: v.number(),
    pathScanMax: v.number(),
    ttlS: v.number(),
  }),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const now = Date.now();
    const rows = await ctx.db
      .query("security_blocklist")
      .withIndex("by_status_and_created", (q) => q.eq("status", "active"))
      .take(BLOCKLIST_CAP);
    const blocked: string[] = [];
    for (const r of rows) {
      if (r.type !== "ip") continue;
      if (r.expires_at && r.expires_at < now) continue;
      blocked.push(r.value);
    }
    const s = await ctx.db
      .query("security_settings")
      .withIndex("by_key", (q) => q.eq("key", SETTINGS_KEY))
      .first();
    return {
      blocked,
      safelist: s?.safelist_ips ?? [],
      killSwitch: s?.kill_switch ?? DEFAULT_SETTINGS.kill_switch,
      mode: s?.enforcement_mode ?? DEFAULT_SETTINGS.enforcement_mode,
      autoBlock: s?.auto_block_enabled ?? DEFAULT_SETTINGS.auto_block_enabled,
      reqWindowS: s?.req_burst_window_s ?? DEFAULT_SETTINGS.req_burst_window_s,
      reqMax: s?.req_burst_max ?? DEFAULT_SETTINGS.req_burst_max,
      denyMax: s?.deny_burst_max ?? DEFAULT_SETTINGS.deny_burst_max,
      pathScanMax:
        s?.path_scan_distinct_max ?? DEFAULT_SETTINGS.path_scan_distinct_max,
      ttlS: s?.auto_block_ttl_s ?? DEFAULT_SETTINGS.auto_block_ttl_s,
    };
  },
});

export const listBlocklistForBackend = query({
  args: { serviceKey: v.string() },
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const rows = await ctx.db
      .query("security_blocklist")
      .withIndex("by_status_and_created", (q) => q.eq("status", "active"))
      .order("desc")
      .take(BLOCKLIST_CAP);
    return rows.map((r) => ({
      id: r._id,
      type: r.type,
      value: r.value,
      reason: r.reason ?? null,
      source: r.source,
      category: r.category ?? null,
      createdBy: r.created_by ?? null,
      createdAt: r.created_at,
      expiresAt: r.expires_at ?? null,
      hits: r.hits ?? 0,
    }));
  },
});

export const addBlockForBackend = mutation({
  args: {
    serviceKey: v.string(),
    type: v.union(
      v.literal("ip"),
      v.literal("cidr"),
      v.literal("user_agent"),
      v.literal("path_pattern"),
    ),
    value: v.string(),
    reason: v.optional(v.string()),
    source: v.union(v.literal("manual"), v.literal("auto")),
    category: v.optional(v.string()),
    ttlSeconds: v.optional(v.number()),
    createdBy: v.optional(v.string()),
  },
  returns: v.object({ id: v.id("security_blocklist"), created: v.boolean() }),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const value = args.value.trim();
    if (!value) throw new Error("Valor vazio");
    const now = Date.now();
    // Idempotente: se já há um bloqueio ATIVO para type+value, só renova/retorna.
    const existing = await ctx.db
      .query("security_blocklist")
      .withIndex("by_value", (q) => q.eq("type", args.type).eq("value", value))
      .filter((q) => q.eq(q.field("status"), "active"))
      .first();
    const expiresAt =
      args.ttlSeconds && args.ttlSeconds > 0
        ? now + args.ttlSeconds * 1000
        : undefined;
    if (existing) {
      await ctx.db.patch(existing._id, {
        expires_at: expiresAt,
        reason: args.reason ?? existing.reason,
      });
      return { id: existing._id, created: false };
    }
    const id = await ctx.db.insert("security_blocklist", {
      type: args.type,
      value,
      reason: args.reason,
      source: args.source,
      category: args.category,
      created_by: args.createdBy,
      created_at: now,
      expires_at: expiresAt,
      status: "active",
      hits: 0,
    });
    return { id, created: true };
  },
});

export const liftBlockForBackend = mutation({
  args: {
    serviceKey: v.string(),
    blockId: v.id("security_blocklist"),
    liftedBy: v.optional(v.string()),
  },
  returns: v.object({
    ok: v.boolean(),
    type: v.string(),
    value: v.string(),
  }),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const row = await ctx.db.get(args.blockId);
    if (!row) throw new Error("Bloqueio inexistente");
    if (row.status === "active") {
      await ctx.db.patch(row._id, {
        status: "lifted",
        lifted_by: args.liftedBy,
        lifted_at: Date.now(),
      });
    }
    return { ok: true, type: row.type, value: row.value };
  },
});

export const getSecuritySettingsForBackend = query({
  args: { serviceKey: v.string() },
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const doc = await ctx.db
      .query("security_settings")
      .withIndex("by_key", (q) => q.eq("key", SETTINGS_KEY))
      .first();
    if (!doc) return { key: SETTINGS_KEY, ...DEFAULT_SETTINGS };
    return {
      key: doc.key,
      enforcement_mode: doc.enforcement_mode,
      auto_block_enabled: doc.auto_block_enabled,
      auto_suspend_users: doc.auto_suspend_users,
      kill_switch: doc.kill_switch,
      req_burst_window_s: doc.req_burst_window_s,
      req_burst_max: doc.req_burst_max,
      deny_burst_max: doc.deny_burst_max,
      path_scan_distinct_max: doc.path_scan_distinct_max,
      auto_block_ttl_s: doc.auto_block_ttl_s,
      safelist_ips: doc.safelist_ips,
      safelist_user_ids: doc.safelist_user_ids,
    };
  },
});

export const setSecuritySettingsForBackend = mutation({
  args: {
    serviceKey: v.string(),
    enforcement_mode: v.union(v.literal("shadow"), v.literal("enforce")),
    auto_block_enabled: v.boolean(),
    auto_suspend_users: v.boolean(),
    kill_switch: v.boolean(),
    req_burst_window_s: v.number(),
    req_burst_max: v.number(),
    deny_burst_max: v.number(),
    path_scan_distinct_max: v.number(),
    auto_block_ttl_s: v.number(),
    safelist_ips: v.array(v.string()),
    safelist_user_ids: v.array(v.string()),
    updatedBy: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const now = Date.now();
    const doc = await ctx.db
      .query("security_settings")
      .withIndex("by_key", (q) => q.eq("key", SETTINGS_KEY))
      .first();
    const fields = {
      key: SETTINGS_KEY,
      enforcement_mode: args.enforcement_mode,
      auto_block_enabled: args.auto_block_enabled,
      auto_suspend_users: args.auto_suspend_users,
      kill_switch: args.kill_switch,
      req_burst_window_s: args.req_burst_window_s,
      req_burst_max: args.req_burst_max,
      deny_burst_max: args.deny_burst_max,
      path_scan_distinct_max: args.path_scan_distinct_max,
      auto_block_ttl_s: args.auto_block_ttl_s,
      safelist_ips: args.safelist_ips.map((s) => s.trim()).filter(Boolean),
      safelist_user_ids: args.safelist_user_ids
        .map((s) => s.trim())
        .filter(Boolean),
      updated_by: args.updatedBy,
      updated_at: now,
    };
    if (doc) await ctx.db.patch(doc._id, fields);
    else await ctx.db.insert("security_settings", fields);
    return null;
  },
});

// Reexport de tipo p/ uso futuro (Slice 2 detector).
export type SecurityBlockId = Id<"security_blocklist">;

/**
 * Registra uma AMEAÇA detectada pela borda (fire-and-forget). Insere o evento no
 * security_audit_log, opcionalmente auto-bloqueia o IP (TTL) e dispara a
 * notificação imediata (Teams/e-mail). NUNCA é fail-closed — é chamada
 * best-effort do proxy; se falhar, o request já seguiu.
 */
export const recordThreatForBackend = mutation({
  args: {
    serviceKey: v.string(),
    eventType: v.union(
      v.literal("threat.detected"),
      v.literal("enumeration.detected"),
      v.literal("anomaly.detected"),
    ),
    ip: v.optional(v.string()),
    detail: v.string(),
    autoBlock: v.boolean(),
    ttlSeconds: v.number(),
  },
  returns: v.object({ blocked: v.boolean() }),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const now = Date.now();
    const detail = args.detail.slice(0, 1000);
    await ctx.db.insert("security_audit_log", {
      event_type: args.eventType,
      actor_kind: "system",
      ip: args.ip,
      target_type: args.ip ? "ip" : undefined,
      target_id: args.ip,
      outcome: "denied",
      detail,
      created_at: now,
    });

    let blocked = false;
    if (args.autoBlock && args.ip) {
      const existing = await ctx.db
        .query("security_blocklist")
        .withIndex("by_value", (q) =>
          q.eq("type", "ip").eq("value", args.ip as string),
        )
        .filter((q) => q.eq(q.field("status"), "active"))
        .first();
      if (!existing) {
        const ttl = args.ttlSeconds > 0 ? args.ttlSeconds : 3600;
        await ctx.db.insert("security_blocklist", {
          type: "ip",
          value: args.ip,
          reason: detail.slice(0, 200),
          source: "auto",
          category: "ioa",
          created_at: now,
          expires_at: now + ttl * 1000,
          status: "active",
          hits: 0,
        });
        await ctx.db.insert("security_audit_log", {
          event_type: "ip.blocked",
          actor_kind: "system",
          ip: args.ip,
          target_type: "ip",
          target_id: args.ip,
          outcome: "denied",
          detail: `auto-block: ${detail.slice(0, 200)}`,
          created_at: now,
        });
        blocked = true;
      }
    }

    await ctx.scheduler.runAfter(0, internal.security.dispatchSecurityNotify, {
      subject: `[Segurança] ${args.eventType}${args.ip ? ` · ${args.ip}` : ""}`,
      body: `${detail}${blocked ? "\nAção: IP auto-bloqueado (TTL)." : "\n(modo sombra — sem bloqueio automático)"}`,
    });
    return { blocked };
  },
});

/**
 * Dispara a notificação de segurança (Teams/e-mail), inline e best-effort.
 * Reusa os destinos configurados em monitorSettings (aba Alertas). NUNCA lança.
 */
export const dispatchSecurityNotify = internalAction({
  args: { subject: v.string(), body: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    try {
      const serviceKey = process.env.CONVEX_SERVICE_ROLE_KEY;
      if (!serviceKey) return null;
      const channels = await ctx.runQuery(api.monitorSettings.get, {
        serviceKey,
      });
      if (channels.teams_webhook_url) {
        try {
          const res = await fetch(channels.teams_webhook_url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              text: `**${args.subject}**\n\n${args.body}`,
            }),
          });
          if (!res.ok) console.warn(`[sec-notify] Teams HTTP ${res.status}`);
        } catch (e) {
          console.warn("[sec-notify] Teams falhou", e);
        }
      }
      const apiKey = process.env.RESEND_API_KEY;
      if (channels.email_to && apiKey) {
        try {
          const from =
            process.env.ALERT_EMAIL_FROM ??
            "Suricatoos Alertas <alertas@suricatoos.com>";
          const res = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from,
              to: [channels.email_to],
              subject: args.subject,
              text: args.body,
            }),
          });
          if (!res.ok) console.warn(`[sec-notify] Resend HTTP ${res.status}`);
        } catch (e) {
          console.warn("[sec-notify] e-mail falhou", e);
        }
      }
    } catch (e) {
      console.warn("[sec-notify] dispatch falhou (não-fatal)", e);
    }
    return null;
  },
});

/**
 * Ameaça de USUÁRIO autenticado (negações repetidas em rota privilegiada).
 * Insere o evento, opcionalmente auto-suspende (reusa adminSuspend via action) e
 * notifica. A decisão final de suspender respeita a safelist_user_ids; o detector
 * Node já filtrou staff (superadmin/analista). Fire-and-forget.
 */
export const recordUserThreatForBackend = mutation({
  args: {
    serviceKey: v.string(),
    userId: v.string(),
    email: v.optional(v.string()),
    detail: v.string(),
    autoSuspend: v.boolean(),
  },
  returns: v.object({ suspended: v.boolean() }),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const now = Date.now();
    const detail = args.detail.slice(0, 1000);
    await ctx.db.insert("security_audit_log", {
      event_type: "user.autoblocked",
      actor_kind: "system",
      actor_user_id: args.userId,
      actor_email: args.email,
      target_type: "user",
      target_id: args.userId,
      outcome: "denied",
      detail,
      created_at: now,
    });
    let willSuspend = false;
    if (args.autoSuspend) {
      const s = await ctx.db
        .query("security_settings")
        .withIndex("by_key", (q) => q.eq("key", SETTINGS_KEY))
        .first();
      const safe = s?.safelist_user_ids ?? [];
      if (!safe.includes(args.userId)) {
        willSuspend = true;
        await ctx.scheduler.runAfter(0, internal.security.autoSuspendUser, {
          userId: args.userId,
          detail: detail.slice(0, 200),
        });
      }
    }
    await ctx.scheduler.runAfter(0, internal.security.dispatchSecurityNotify, {
      subject: `[Segurança] usuário atacante${args.email ? ` · ${args.email}` : ""}`,
      body: `${detail}${willSuspend ? "\nAção: usuário AUTO-SUSPENSO (reversível na aba Usuários)." : "\n(modo sombra — sem suspensão)"}`,
    });
    return { suspended: willSuspend };
  },
});

/**
 * Executa a auto-suspensão reusando adminSuspend (serviceKey do env). É reversível
 * pelo mesmo unsuspend da aba Usuários. best-effort.
 */
export const autoSuspendUser = internalAction({
  args: { userId: v.string(), detail: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    try {
      const serviceKey = process.env.CONVEX_SERVICE_ROLE_KEY;
      if (!serviceKey) return null;
      await ctx.runMutation(api.userSuspensions.adminSuspend, {
        serviceKey,
        userId: args.userId,
        reason: `auto-block de segurança: ${args.detail}`,
        adminEmail: "security-auto",
      });
    } catch (e) {
      console.warn("[sec] autoSuspendUser falhou", e);
    }
    return null;
  },
});
