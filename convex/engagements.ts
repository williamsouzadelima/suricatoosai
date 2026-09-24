import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { validateServiceKey } from "./lib/utils";

/**
 * Engajamentos (agrupam chats + evidências + achados de um cliente).
 * v1 interno: posse por analista (user_id === identity.subject).
 */

const engagementStatusValidator = v.union(
  v.literal("planned"),
  v.literal("active"),
  v.literal("review"),
  v.literal("reporting"),
  v.literal("closed"),
);

const scopeItemArg = v.object({
  kind: v.union(
    v.literal("domain"),
    v.literal("ip"),
    v.literal("cidr"),
    v.literal("url"),
    v.literal("app"),
    v.literal("other"),
  ),
  value: v.string(),
  in_scope: v.boolean(),
  note: v.optional(v.string()),
});

const UNASSIGNED_SLUG = "nao-atribuido";
const TRIAGE_NAME = "Triagem";

async function assertOwnedEngagement(
  ctx: QueryCtx,
  engagementId: Id<"engagements">,
) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new ConvexError({
      code: "UNAUTHORIZED",
      message: "Unauthorized: User not authenticated",
    });
  }
  const engagement = await ctx.db.get(engagementId);
  if (!engagement || engagement.user_id !== identity.subject) {
    throw new ConvexError({ code: "ACCESS_DENIED", message: "Sem acesso" });
  }
  return { identity, engagement };
}

export const listEngagements = query({
  args: { clientId: v.optional(v.id("clients")) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    if (args.clientId) {
      const rows = await ctx.db
        .query("engagements")
        .withIndex("by_client_and_updated", (q) =>
          q.eq("client_id", args.clientId!),
        )
        .order("desc")
        .collect();
      return rows.filter((e) => e.user_id === identity.subject);
    }
    return await ctx.db
      .query("engagements")
      .withIndex("by_user_and_updated", (q) =>
        q.eq("user_id", identity.subject),
      )
      .order("desc")
      .collect();
  },
});

export const getEngagement = query({
  args: { engagementId: v.id("engagements") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const engagement = await ctx.db.get(args.engagementId);
    if (!engagement || engagement.user_id !== identity.subject) return null;
    return engagement;
  },
});

export const createEngagement = mutation({
  args: {
    clientId: v.id("clients"),
    name: v.string(),
    code: v.optional(v.string()),
    scope: v.optional(v.array(scopeItemArg)),
    startsAt: v.optional(v.number()),
    endsAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError({
        code: "UNAUTHORIZED",
        message: "Unauthorized",
      });
    }
    const client = await ctx.db.get(args.clientId);
    if (!client || client.user_id !== identity.subject) {
      throw new ConvexError({
        code: "ACCESS_DENIED",
        message: "Cliente inexistente ou sem acesso",
      });
    }
    if (!args.name.trim()) {
      throw new ConvexError({ code: "INVALID", message: "Nome vazio" });
    }
    const now = Date.now();
    return await ctx.db.insert("engagements", {
      user_id: identity.subject,
      organization_id: client.organization_id,
      client_id: args.clientId,
      code: args.code?.trim() || undefined,
      name: args.name.trim(),
      status: "planned",
      scope: args.scope,
      starts_at: args.startsAt,
      ends_at: args.endsAt,
      created_at: now,
      updated_at: now,
    });
  },
});

export const updateEngagement = mutation({
  args: {
    engagementId: v.id("engagements"),
    name: v.optional(v.string()),
    code: v.optional(v.string()),
    status: v.optional(engagementStatusValidator),
    scope: v.optional(v.array(scopeItemArg)),
    startsAt: v.optional(v.number()),
    endsAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await assertOwnedEngagement(ctx, args.engagementId);
    const patch: Record<string, unknown> = { updated_at: Date.now() };
    if (args.name !== undefined) {
      if (!args.name.trim()) {
        throw new ConvexError({ code: "INVALID", message: "Nome vazio" });
      }
      patch.name = args.name.trim();
    }
    if (args.code !== undefined) patch.code = args.code.trim() || undefined;
    if (args.status !== undefined) patch.status = args.status;
    if (args.scope !== undefined) patch.scope = args.scope;
    if (args.startsAt !== undefined) patch.starts_at = args.startsAt;
    if (args.endsAt !== undefined) patch.ends_at = args.endsAt;
    await ctx.db.patch(args.engagementId, patch);
    return null;
  },
});

/** Chats anexados a um engajamento (reativo) — alimenta a visão ao vivo. */
export const getChatsForEngagement = query({
  args: { engagementId: v.id("engagements") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const engagement = await ctx.db.get(args.engagementId);
    if (!engagement || engagement.user_id !== identity.subject) return [];
    const chats = await ctx.db
      .query("chats")
      .withIndex("by_engagement_and_updated", (q) =>
        q.eq("engagement_id", args.engagementId),
      )
      .order("desc")
      .collect();
    return chats.map((c) => ({
      id: c.id,
      title: c.title,
      active_trigger_run_id: c.active_trigger_run_id ?? null,
      update_time: c.update_time,
    }));
  },
});

export const attachChatToEngagement = mutation({
  args: { chatId: v.string(), engagementId: v.id("engagements") },
  handler: async (ctx, args) => {
    const { identity } = await assertOwnedEngagement(ctx, args.engagementId);
    const chat = await ctx.db
      .query("chats")
      .withIndex("by_chat_id", (q) => q.eq("id", args.chatId))
      .first();
    if (!chat || chat.user_id !== identity.subject) {
      throw new ConvexError({
        code: "ACCESS_DENIED",
        message: "Chat sem acesso",
      });
    }
    await ctx.db.patch(chat._id, { engagement_id: args.engagementId });
    return null;
  },
});

export const detachChatFromEngagement = mutation({
  args: { chatId: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError({ code: "UNAUTHORIZED", message: "Unauthorized" });
    }
    const chat = await ctx.db
      .query("chats")
      .withIndex("by_chat_id", (q) => q.eq("id", args.chatId))
      .first();
    if (!chat || chat.user_id !== identity.subject) {
      throw new ConvexError({ code: "ACCESS_DENIED", message: "Sem acesso" });
    }
    await ctx.db.patch(chat._id, { engagement_id: undefined });
    return null;
  },
});

/**
 * Resolve o engagement_id de um chat para o agente (serviceKey). Se o chat já
 * está anexado, devolve-o; senão provisiona (lazy) um engajamento "Triagem" sob
 * o cliente "Não atribuído" do usuário. Nunca falha por falta de engajamento.
 */
export const resolveEngagementForChatBackend = mutation({
  args: { serviceKey: v.string(), userId: v.string(), chatId: v.string() },
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const chat = await ctx.db
      .query("chats")
      .withIndex("by_chat_id", (q) => q.eq("id", args.chatId))
      .first();
    if (chat?.engagement_id) {
      const eng = await ctx.db.get(chat.engagement_id);
      // Só devolve o engajamento existente quando pertence ao próprio userId;
      // senão cai no provisionamento lazy sob args.userId (evita cross-tenant).
      if (eng && eng.user_id === args.userId) {
        return { engagementId: eng._id, clientId: eng.client_id };
      }
    }

    // Cliente "Não atribuído" (lazy)
    let client = await ctx.db
      .query("clients")
      .withIndex("by_user_and_slug", (q) =>
        q.eq("user_id", args.userId).eq("slug", UNASSIGNED_SLUG),
      )
      .first();
    const now = Date.now();
    let clientId: Id<"clients">;
    if (client) {
      clientId = client._id;
    } else {
      clientId = await ctx.db.insert("clients", {
        user_id: args.userId,
        name: "Não atribuído",
        slug: UNASSIGNED_SLUG,
        status: "active",
        created_at: now,
        updated_at: now,
      });
    }

    // Engajamento "Triagem" (lazy): primeiro do cliente com esse nome, senão cria.
    const existing = await ctx.db
      .query("engagements")
      .withIndex("by_client_and_updated", (q) => q.eq("client_id", clientId))
      .order("desc")
      .collect();
    const triage = existing.find((e) => e.name === TRIAGE_NAME);
    let engagementId: Id<"engagements">;
    if (triage) {
      engagementId = triage._id;
    } else {
      engagementId = await ctx.db.insert("engagements", {
        user_id: args.userId,
        client_id: clientId,
        name: TRIAGE_NAME,
        status: "active",
        created_at: now,
        updated_at: now,
      });
    }

    // Anexa o chat ao engajamento de triagem (se o chat existir e for do user).
    if (chat && chat.user_id === args.userId && !chat.engagement_id) {
      await ctx.db.patch(chat._id, { engagement_id: engagementId });
    }
    return { engagementId, clientId };
  },
});
