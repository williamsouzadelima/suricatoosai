import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { validateServiceKey } from "./lib/utils";

/**
 * Fase 4: dedup durável de alertas de orçamento. claimAlert é um insert-if-absent
 * atômico (mutation é transacional) → só o primeiro claim de um
 * scope+scope_id+período+threshold retorna claimed:true. Sobrevive aos retries do
 * Trigger e a cruzamentos multi-run do teto por usuário → 1 alerta por evento.
 */

export const claimAlert = mutation({
  args: {
    serviceKey: v.string(),
    scope: v.union(v.literal("task"), v.literal("user")),
    scopeId: v.string(),
    periodKey: v.string(),
    threshold: v.string(),
    costDollars: v.optional(v.number()),
    nowMs: v.optional(v.number()),
  },
  returns: v.object({ claimed: v.boolean() }),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const existing = await ctx.db
      .query("budget_alerts")
      .withIndex("by_scope_key", (q) =>
        q
          .eq("scope", args.scope)
          .eq("scope_id", args.scopeId)
          .eq("period_key", args.periodKey)
          .eq("threshold", args.threshold),
      )
      .unique();
    if (existing) return { claimed: false };
    await ctx.db.insert("budget_alerts", {
      scope: args.scope,
      scope_id: args.scopeId,
      period_key: args.periodKey,
      threshold: args.threshold,
      notified_at: args.nowMs ?? Date.now(),
      cost_at_alert: args.costDollars,
    });
    return { claimed: true };
  },
});

export const listRecent = query({
  args: { serviceKey: v.string(), limit: v.optional(v.number()) },
  returns: v.array(
    v.object({
      scope: v.string(),
      scope_id: v.string(),
      period_key: v.string(),
      threshold: v.string(),
      notified_at: v.number(),
      cost_at_alert: v.optional(v.number()),
    }),
  ),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const rows = await ctx.db
      .query("budget_alerts")
      .order("desc")
      .take(args.limit ?? 100);
    return rows.map((r) => ({
      scope: r.scope,
      scope_id: r.scope_id,
      period_key: r.period_key,
      threshold: r.threshold,
      notified_at: r.notified_at,
      cost_at_alert: r.cost_at_alert,
    }));
  },
});
