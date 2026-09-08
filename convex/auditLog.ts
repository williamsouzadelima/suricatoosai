import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { validateServiceKey } from "./lib/utils";

/**
 * Log de auditoria das ações do /admin. Registrado (best-effort) pelas rotas
 * superadmin após cada ação sensível; listado na aba "Auditoria".
 */

export const record = mutation({
  args: {
    serviceKey: v.string(),
    actor: v.string(),
    action: v.string(),
    target: v.optional(v.string()),
    detail: v.optional(v.string()),
    nowMs: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    await ctx.db.insert("audit_log", {
      actor: args.actor,
      action: args.action,
      target: args.target,
      detail: args.detail,
      created_at: args.nowMs ?? Date.now(),
    });
    return null;
  },
});

export const list = query({
  args: { serviceKey: v.string(), limit: v.optional(v.number()) },
  returns: v.array(
    v.object({
      actor: v.string(),
      action: v.string(),
      target: v.optional(v.string()),
      detail: v.optional(v.string()),
      created_at: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const rows = await ctx.db
      .query("audit_log")
      .withIndex("by_created_at")
      .order("desc")
      .take(Math.min(args.limit ?? 200, 1000));
    return rows.map((r) => ({
      actor: r.actor,
      action: r.action,
      target: r.target,
      detail: r.detail,
      created_at: r.created_at,
    }));
  },
});
