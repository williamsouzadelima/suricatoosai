import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { validateServiceKey } from "./lib/utils";

/**
 * E-mail marketing: suppression list (descadastro) + log de campanhas.
 * Os destinatários vêm da access_allowlist (segmentos ativo/convidado); aqui
 * só guardamos quem optou por não receber e o histórico de envios.
 * `optOut` é chamado pela rota pública /unsubscribe (com service key no server).
 */

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

export const getOptOutEmails = query({
  args: { serviceKey: v.string() },
  returns: v.array(v.string()),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const rows = await ctx.db.query("email_optouts").take(5000);
    return rows.map((r) => r.email);
  },
});

export const isOptedOut = query({
  args: { serviceKey: v.string(), email: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const email = normalizeEmail(args.email);
    const row = await ctx.db
      .query("email_optouts")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    return row !== null;
  },
});

export const optOut = mutation({
  args: {
    serviceKey: v.string(),
    email: v.string(),
    source: v.optional(v.string()),
    nowMs: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const email = normalizeEmail(args.email);
    if (!email) return null;
    const existing = await ctx.db
      .query("email_optouts")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    if (!existing) {
      await ctx.db.insert("email_optouts", {
        email,
        opted_out_at: args.nowMs ?? Date.now(),
        source: args.source,
      });
    }
    return null;
  },
});

export const optIn = mutation({
  args: { serviceKey: v.string(), email: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const email = normalizeEmail(args.email);
    const existing = await ctx.db
      .query("email_optouts")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    if (existing) await ctx.db.delete(existing._id);
    return null;
  },
});

export const logCampaign = mutation({
  args: {
    serviceKey: v.string(),
    subject: v.string(),
    segment: v.string(),
    total: v.number(),
    sent: v.number(),
    failed: v.number(),
    createdBy: v.optional(v.string()),
    nowMs: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    await ctx.db.insert("email_campaigns", {
      subject: args.subject,
      segment: args.segment,
      total: args.total,
      sent: args.sent,
      failed: args.failed,
      created_by: args.createdBy,
      created_at: args.nowMs ?? Date.now(),
    });
    return null;
  },
});

export const listCampaigns = query({
  args: { serviceKey: v.string(), limit: v.optional(v.number()) },
  returns: v.array(
    v.object({
      subject: v.string(),
      segment: v.string(),
      total: v.number(),
      sent: v.number(),
      failed: v.number(),
      created_by: v.optional(v.string()),
      created_at: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const rows = await ctx.db
      .query("email_campaigns")
      .withIndex("by_created_at")
      .order("desc")
      .take(Math.min(args.limit ?? 20, 100));
    return rows.map((r) => ({
      subject: r.subject,
      segment: r.segment,
      total: r.total,
      sent: r.sent,
      failed: r.failed,
      created_by: r.created_by,
      created_at: r.created_at,
    }));
  },
});
