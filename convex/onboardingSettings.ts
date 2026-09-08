import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { validateServiceKey } from "./lib/utils";

/**
 * Config do e-mail de boas-vindas automático (enviado no 1º acesso do
 * convidado). Doc único key="global", gerenciado pelo /admin (service-key).
 */

const KEY = "global";

const DEFAULT_SUBJECT = "Bem-vindo(a) ao Suricatoos 🐾";
const DEFAULT_BODY = `Olá!

Seu acesso ao Suricatoos está ativo. É só entrar e começar.

Qualquer dúvida, é só responder este e-mail.

— Equipe Suricatoos`;

const shape = v.object({
  enabled: v.boolean(),
  subject: v.string(),
  body: v.string(),
  updated_by: v.optional(v.string()),
  updated_at: v.optional(v.number()),
});

export const get = query({
  args: { serviceKey: v.string() },
  returns: shape,
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const row = await ctx.db
      .query("welcome_settings")
      .withIndex("by_key", (q) => q.eq("key", KEY))
      .unique();
    if (!row) {
      return { enabled: false, subject: DEFAULT_SUBJECT, body: DEFAULT_BODY };
    }
    return {
      enabled: row.enabled,
      subject: row.subject,
      body: row.body,
      updated_by: row.updated_by,
      updated_at: row.updated_at,
    };
  },
});

export const update = mutation({
  args: {
    serviceKey: v.string(),
    enabled: v.boolean(),
    subject: v.string(),
    body: v.string(),
    updatedBy: v.optional(v.string()),
    nowMs: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const now = args.nowMs ?? Date.now();
    const row = await ctx.db
      .query("welcome_settings")
      .withIndex("by_key", (q) => q.eq("key", KEY))
      .unique();
    const doc = {
      key: KEY,
      enabled: args.enabled,
      subject: args.subject,
      body: args.body,
      updated_by: args.updatedBy,
      updated_at: now,
    };
    if (row) await ctx.db.patch(row._id, doc);
    else await ctx.db.insert("welcome_settings", doc);
    return null;
  },
});
