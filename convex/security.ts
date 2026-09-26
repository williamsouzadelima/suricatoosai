import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
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
    const settings = await ctx.db
      .query("security_settings")
      .withIndex("by_key", (q) => q.eq("key", SETTINGS_KEY))
      .first();
    return {
      blocked,
      safelist: settings?.safelist_ips ?? [],
      killSwitch: settings?.kill_switch ?? false,
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
