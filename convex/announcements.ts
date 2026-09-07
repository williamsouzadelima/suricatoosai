import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { validateServiceKey } from "./lib/utils";

/**
 * Avisos in-app (banner). Publicados pelo /admin (superadmin, service-key
 * gated) e exibidos a todos os usuários via `getActive` (sem service key —
 * é conteúdo de exibição). Dispensa por usuário é client-side (localStorage).
 */

const levelValidator = v.union(
  v.literal("info"),
  v.literal("warning"),
  v.literal("success"),
);

// No `returns` usamos v.string() no lugar do union p/ não estourar o limite de
// complexidade do tsc (TS2719) contra o DataModel grande — mesmo motivo do
// accessAllowlist.addInvite.
const publicAnnouncement = v.object({
  id: v.id("announcements"),
  title: v.string(),
  body: v.string(),
  level: v.string(),
  dismissible: v.boolean(),
  cta_label: v.optional(v.string()),
  cta_url: v.optional(v.string()),
  updated_at: v.number(),
});

/** Avisos atualmente visíveis (ativos e dentro da janela de tempo). */
export const getActive = query({
  args: {},
  returns: v.array(publicAnnouncement),
  handler: async (ctx) => {
    const now = Date.now();
    const rows = await ctx.db
      .query("announcements")
      .withIndex("by_active", (q) => q.eq("active", true))
      .take(50);

    return rows
      .filter(
        (r) =>
          (r.starts_at === undefined || r.starts_at <= now) &&
          (r.ends_at === undefined || r.ends_at >= now),
      )
      .sort((a, b) => b.updated_at - a.updated_at)
      .map((r) => ({
        id: r._id,
        title: r.title,
        body: r.body,
        level: r.level,
        dismissible: r.dismissible,
        cta_label: r.cta_label,
        cta_url: r.cta_url,
        updated_at: r.updated_at,
      }));
  },
});

const adminAnnouncement = v.object({
  id: v.id("announcements"),
  title: v.string(),
  body: v.string(),
  level: v.string(),
  active: v.boolean(),
  dismissible: v.boolean(),
  starts_at: v.optional(v.number()),
  ends_at: v.optional(v.number()),
  cta_label: v.optional(v.string()),
  cta_url: v.optional(v.string()),
  created_by: v.optional(v.string()),
  created_at: v.number(),
  updated_at: v.number(),
});

/** Todos os avisos (para o painel). */
export const list = query({
  args: { serviceKey: v.string() },
  returns: v.array(adminAnnouncement),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const rows = await ctx.db.query("announcements").take(500);
    return rows
      .sort((a, b) => b.created_at - a.created_at)
      .map((r) => ({
        id: r._id,
        title: r.title,
        body: r.body,
        level: r.level,
        active: r.active,
        dismissible: r.dismissible,
        starts_at: r.starts_at,
        ends_at: r.ends_at,
        cta_label: r.cta_label,
        cta_url: r.cta_url,
        created_by: r.created_by,
        created_at: r.created_at,
        updated_at: r.updated_at,
      }));
  },
});

export const create = mutation({
  args: {
    serviceKey: v.string(),
    title: v.string(),
    body: v.string(),
    level: levelValidator,
    active: v.boolean(),
    dismissible: v.boolean(),
    starts_at: v.optional(v.number()),
    ends_at: v.optional(v.number()),
    cta_label: v.optional(v.string()),
    cta_url: v.optional(v.string()),
    createdBy: v.optional(v.string()),
    nowMs: v.optional(v.number()),
  },
  returns: v.id("announcements"),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const now = args.nowMs ?? Date.now();
    return await ctx.db.insert("announcements", {
      title: args.title,
      body: args.body,
      level: args.level,
      active: args.active,
      dismissible: args.dismissible,
      starts_at: args.starts_at,
      ends_at: args.ends_at,
      cta_label: args.cta_label,
      cta_url: args.cta_url,
      created_by: args.createdBy,
      created_at: now,
      updated_at: now,
    });
  },
});

export const update = mutation({
  args: {
    serviceKey: v.string(),
    id: v.id("announcements"),
    title: v.string(),
    body: v.string(),
    level: levelValidator,
    active: v.boolean(),
    dismissible: v.boolean(),
    starts_at: v.optional(v.number()),
    ends_at: v.optional(v.number()),
    cta_label: v.optional(v.string()),
    cta_url: v.optional(v.string()),
    nowMs: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    await ctx.db.patch(args.id, {
      title: args.title,
      body: args.body,
      level: args.level,
      active: args.active,
      dismissible: args.dismissible,
      starts_at: args.starts_at,
      ends_at: args.ends_at,
      cta_label: args.cta_label,
      cta_url: args.cta_url,
      updated_at: args.nowMs ?? Date.now(),
    });
    return null;
  },
});

export const setActive = mutation({
  args: {
    serviceKey: v.string(),
    id: v.id("announcements"),
    active: v.boolean(),
    nowMs: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    await ctx.db.patch(args.id, {
      active: args.active,
      updated_at: args.nowMs ?? Date.now(),
    });
    return null;
  },
});

export const remove = mutation({
  args: { serviceKey: v.string(), id: v.id("announcements") },
  returns: v.null(),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    await ctx.db.delete(args.id);
    return null;
  },
});
