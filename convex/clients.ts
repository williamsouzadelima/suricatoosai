import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { validateServiceKey } from "./lib/utils";

/**
 * Clientes da feature de engajamentos/relatórios.
 *
 * v1 (interno): posse por analista (user_id === identity.subject), espelhando o
 * padrão de convex/notes.ts e convex/chats.ts. As linhas já carregam
 * organization_id (opcional) para o portal do cliente (v2), sem migração.
 */

const UNASSIGNED_SLUG = "nao-atribuido";

function slugify(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return base || "cliente";
}

function requireIdentity(subject: string | undefined) {
  if (!subject) {
    throw new ConvexError({
      code: "UNAUTHORIZED",
      message: "Unauthorized: User not authenticated",
    });
  }
}

/** Lista os clientes do analista autenticado (reativo). */
export const listClients = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    return await ctx.db
      .query("clients")
      .withIndex("by_user_and_updated", (q) =>
        q.eq("user_id", identity.subject),
      )
      .order("desc")
      .collect();
  },
});

/** Um cliente por id, checando posse. */
export const getClient = query({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const client = await ctx.db.get(args.clientId);
    if (!client || client.user_id !== identity.subject) return null;
    return client;
  },
});

export const createClient = mutation({
  args: {
    name: v.string(),
    primaryContactEmail: v.optional(v.string()),
    organizationId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    requireIdentity(identity?.subject);
    const userId = identity!.subject;
    if (!args.name.trim()) {
      throw new ConvexError({ code: "INVALID", message: "Nome vazio" });
    }
    const now = Date.now();
    return await ctx.db.insert("clients", {
      user_id: userId,
      organization_id: args.organizationId,
      name: args.name.trim(),
      slug: slugify(args.name),
      status: "active",
      primary_contact_email: args.primaryContactEmail,
      created_at: now,
      updated_at: now,
    });
  },
});

export const updateClient = mutation({
  args: {
    clientId: v.id("clients"),
    name: v.optional(v.string()),
    primaryContactEmail: v.optional(v.string()),
    status: v.optional(v.union(v.literal("active"), v.literal("archived"))),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    requireIdentity(identity?.subject);
    const client = await ctx.db.get(args.clientId);
    if (!client || client.user_id !== identity!.subject) {
      throw new ConvexError({ code: "ACCESS_DENIED", message: "Sem acesso" });
    }
    const patch: Record<string, unknown> = { updated_at: Date.now() };
    if (args.name !== undefined) {
      if (!args.name.trim()) {
        throw new ConvexError({ code: "INVALID", message: "Nome vazio" });
      }
      patch.name = args.name.trim();
      patch.slug = slugify(args.name);
    }
    if (args.primaryContactEmail !== undefined) {
      patch.primary_contact_email = args.primaryContactEmail;
    }
    if (args.status !== undefined) patch.status = args.status;
    await ctx.db.patch(args.clientId, patch);
    return null;
  },
});

/**
 * Resolve (ou cria) o cliente "Não atribuído" do analista — destino de triagem
 * quando o agente captura um achado num chat sem engajamento. serviceKey.
 */
export const resolveUnassignedClientForBackend = mutation({
  args: { serviceKey: v.string(), userId: v.string() },
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const existing = await ctx.db
      .query("clients")
      .withIndex("by_user_and_slug", (q) =>
        q.eq("user_id", args.userId).eq("slug", UNASSIGNED_SLUG),
      )
      .first();
    if (existing) return existing._id;
    const now = Date.now();
    return await ctx.db.insert("clients", {
      user_id: args.userId,
      name: "Não atribuído",
      slug: UNASSIGNED_SLUG,
      status: "active",
      created_at: now,
      updated_at: now,
    });
  },
});
