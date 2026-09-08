import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { validateServiceKey } from "./lib/utils";

/**
 * Campanhas de e-mail agendadas. O painel cria "pending"; um dispatcher
 * (timer no Kali → /api/cron/dispatch-campaigns) reclama as vencidas de forma
 * atômica (pending -> sending) e grava o resultado. Segmento/envio reusam a
 * mesma lógica do envio imediato.
 */

export const schedule = mutation({
  args: {
    serviceKey: v.string(),
    subject: v.string(),
    body: v.string(),
    segment: v.string(),
    scheduledAt: v.number(),
    createdBy: v.optional(v.string()),
    nowMs: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    await ctx.db.insert("scheduled_campaigns", {
      subject: args.subject,
      body: args.body,
      segment: args.segment,
      scheduled_at: args.scheduledAt,
      status: "pending",
      created_by: args.createdBy,
      created_at: args.nowMs ?? Date.now(),
    });
    return null;
  },
});

/**
 * Reclama atomicamente a próxima campanha vencida (pending -> sending) e a
 * retorna. Chamada em laço pelo dispatcher até `found` ser false.
 */
export const claimNextDue = mutation({
  args: { serviceKey: v.string(), nowMs: v.optional(v.number()) },
  returns: v.object({
    found: v.boolean(),
    id: v.optional(v.id("scheduled_campaigns")),
    subject: v.optional(v.string()),
    body: v.optional(v.string()),
    segment: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const now = args.nowMs ?? Date.now();
    const next = await ctx.db
      .query("scheduled_campaigns")
      .withIndex("by_status_and_time", (q) =>
        q.eq("status", "pending").lte("scheduled_at", now),
      )
      .first();
    if (!next) return { found: false };
    await ctx.db.patch(next._id, { status: "sending" });
    return {
      found: true,
      id: next._id,
      subject: next.subject,
      body: next.body,
      segment: next.segment,
    };
  },
});

export const markResult = mutation({
  args: {
    serviceKey: v.string(),
    id: v.id("scheduled_campaigns"),
    status: v.union(v.literal("sent"), v.literal("failed")),
    total: v.number(),
    sent: v.number(),
    failed: v.number(),
    nowMs: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    await ctx.db.patch(args.id, {
      status: args.status,
      total: args.total,
      sent: args.sent,
      failed: args.failed,
      sent_at: args.nowMs ?? Date.now(),
    });
    return null;
  },
});

export const cancel = mutation({
  args: { serviceKey: v.string(), id: v.id("scheduled_campaigns") },
  returns: v.null(),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const row = await ctx.db.get(args.id);
    if (row && row.status === "pending") {
      await ctx.db.patch(args.id, { status: "canceled" });
    }
    return null;
  },
});

export const listAll = query({
  args: { serviceKey: v.string(), limit: v.optional(v.number()) },
  returns: v.array(
    v.object({
      id: v.id("scheduled_campaigns"),
      subject: v.string(),
      segment: v.string(),
      scheduled_at: v.number(),
      status: v.string(),
      total: v.optional(v.number()),
      sent: v.optional(v.number()),
      failed: v.optional(v.number()),
      created_by: v.optional(v.string()),
      created_at: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const rows = await ctx.db.query("scheduled_campaigns").take(500);
    return rows
      .sort((a, b) => b.scheduled_at - a.scheduled_at)
      .slice(0, Math.min(args.limit ?? 50, 200))
      .map((r) => ({
        id: r._id,
        subject: r.subject,
        segment: r.segment,
        scheduled_at: r.scheduled_at,
        status: r.status,
        total: r.total,
        sent: r.sent,
        failed: r.failed,
        created_by: r.created_by,
        created_at: r.created_at,
      }));
  },
});
