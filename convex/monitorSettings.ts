import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { validateServiceKey } from "./lib/utils";

/**
 * Configuração dos canais de alerta do monitor de saúde (Teams + e-mail).
 * Doc único (key="global"). Gerenciado pelo painel /admin (via rota
 * superadmin-gated) e lido pelo monitor no Kali usando o service key.
 * A chave do Resend NÃO fica aqui — é segredo de servidor no Kali/Next.
 */

const KEY = "global";

const settingsShape = v.object({
  teams_enabled: v.boolean(),
  teams_webhook_url: v.optional(v.string()),
  email_enabled: v.boolean(),
  email_to: v.optional(v.string()),
  updated_by: v.optional(v.string()),
  updated_at: v.optional(v.number()),
});

export const get = query({
  args: { serviceKey: v.string() },
  returns: settingsShape,
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const row = await ctx.db
      .query("monitor_settings")
      .withIndex("by_key", (q) => q.eq("key", KEY))
      .unique();
    if (!row) {
      return { teams_enabled: false, email_enabled: false };
    }
    return {
      teams_enabled: row.teams_enabled,
      teams_webhook_url: row.teams_webhook_url,
      email_enabled: row.email_enabled,
      email_to: row.email_to,
      updated_by: row.updated_by,
      updated_at: row.updated_at,
    };
  },
});

export const update = mutation({
  args: {
    serviceKey: v.string(),
    teams_enabled: v.boolean(),
    teams_webhook_url: v.optional(v.string()),
    email_enabled: v.boolean(),
    email_to: v.optional(v.string()),
    updatedBy: v.optional(v.string()),
    nowMs: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const now = args.nowMs ?? Date.now();

    const row = await ctx.db
      .query("monitor_settings")
      .withIndex("by_key", (q) => q.eq("key", KEY))
      .unique();

    const doc = {
      key: KEY,
      teams_enabled: args.teams_enabled,
      teams_webhook_url: args.teams_webhook_url,
      email_enabled: args.email_enabled,
      email_to: args.email_to,
      updated_by: args.updatedBy,
      updated_at: now,
    };

    if (row) {
      await ctx.db.patch(row._id, doc);
    } else {
      await ctx.db.insert("monitor_settings", doc);
    }
    return null;
  },
});
