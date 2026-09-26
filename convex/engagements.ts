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

/**
 * Anexa um chat a um engajamento pela rota Next (serviceKey + userId explícito;
 * a rota gateia via getInternalUser e passa o WorkOS user.id). Exige posse do
 * engajamento E do chat pelo mesmo userId (anti cross-tenant).
 */
export const attachChatToEngagementForBackend = mutation({
  args: {
    serviceKey: v.string(),
    userId: v.string(),
    chatId: v.string(),
    engagementId: v.id("engagements"),
  },
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const engagement = await ctx.db.get(args.engagementId);
    if (!engagement || engagement.user_id !== args.userId) {
      throw new ConvexError({
        code: "ACCESS_DENIED",
        message: "Engajamento sem acesso",
      });
    }
    const chat = await ctx.db
      .query("chats")
      .withIndex("by_chat_id", (q) => q.eq("id", args.chatId))
      .first();
    if (!chat || chat.user_id !== args.userId) {
      throw new ConvexError({
        code: "ACCESS_DENIED",
        message: "Chat sem acesso",
      });
    }
    await ctx.db.patch(chat._id, { engagement_id: args.engagementId });
    return { chatId: args.chatId, engagementId: args.engagementId };
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

    // Engajamento POR TASK: cada chat/task ganha o seu próprio engajamento,
    // criado na primeira resolução (eager no início da task ou na 1ª captura).
    // Nomeado pelo título do chat quando houver. Idempotente: se um run
    // concorrente já criou e anexou, o `chat.engagement_id` acima já retorna.
    const title = (chat?.title ?? "").trim();
    const engName =
      title || `Engajamento · ${new Date(now).toISOString().slice(0, 10)}`;
    const engagementId = await ctx.db.insert("engagements", {
      user_id: args.userId,
      client_id: clientId,
      name: engName,
      status: "active",
      created_at: now,
      updated_at: now,
    });
    if (chat && chat.user_id === args.userId && !chat.engagement_id) {
      await ctx.db.patch(chat._id, { engagement_id: engagementId });
    }
    return { engagementId, clientId };
  },
});

// ── Scaffold de monetização: faturas por engajamento (identity + posse) ──────
// Sem preço definido — amount_dollars é placeholder. Habilita margem por
// engajamento (receita faturada − custo de IA do engajamento). Ver
// [[suricatoosai-presenca-e-roadmap]].

const INVOICE_COST_CAP = 20000;

export const createInvoice = mutation({
  args: {
    engagementId: v.id("engagements"),
    label: v.string(),
    amountDollars: v.number(),
    currency: v.optional(v.string()),
    dueAt: v.optional(v.number()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError({ code: "UNAUTHORIZED", message: "Unauthorized" });
    }
    const eng = await ctx.db.get(args.engagementId);
    if (!eng || eng.user_id !== identity.subject) {
      throw new ConvexError({
        code: "ACCESS_DENIED",
        message: "Engajamento inexistente ou sem acesso",
      });
    }
    if (!args.label.trim()) {
      throw new ConvexError({ code: "INVALID", message: "Descrição vazia" });
    }
    const amount = Number.isFinite(args.amountDollars)
      ? Math.max(0, args.amountDollars)
      : 0;
    const now = Date.now();
    return await ctx.db.insert("engagement_invoices", {
      user_id: identity.subject,
      organization_id: eng.organization_id,
      client_id: eng.client_id,
      engagement_id: args.engagementId,
      label: args.label.trim().slice(0, 200),
      amount_dollars: amount,
      currency: (args.currency ?? "USD").slice(0, 8),
      status: "draft",
      due_at: args.dueAt,
      note: args.note?.slice(0, 1000),
      created_at: now,
      updated_at: now,
    });
  },
});

export const listInvoicesForEngagement = query({
  args: { engagementId: v.id("engagements") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const eng = await ctx.db.get(args.engagementId);
    if (!eng || eng.user_id !== identity.subject) return [];
    return await ctx.db
      .query("engagement_invoices")
      .withIndex("by_engagement_and_created", (q) =>
        q.eq("engagement_id", args.engagementId),
      )
      .order("desc")
      .collect();
  },
});

async function ownedInvoice(
  ctx: QueryCtx,
  invoiceId: Id<"engagement_invoices">,
) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new ConvexError({ code: "UNAUTHORIZED", message: "Unauthorized" });
  }
  const inv = await ctx.db.get(invoiceId);
  if (!inv || inv.user_id !== identity.subject) {
    throw new ConvexError({ code: "ACCESS_DENIED", message: "Sem acesso" });
  }
  return inv;
}

export const setInvoiceStatus = mutation({
  args: {
    invoiceId: v.id("engagement_invoices"),
    status: v.union(
      v.literal("draft"),
      v.literal("sent"),
      v.literal("paid"),
      v.literal("void"),
    ),
  },
  handler: async (ctx, args) => {
    const inv = await ownedInvoice(ctx, args.invoiceId);
    const now = Date.now();
    await ctx.db.patch(inv._id, {
      status: args.status,
      issued_at: args.status === "sent" && !inv.issued_at ? now : inv.issued_at,
      paid_at:
        args.status === "paid"
          ? now
          : args.status === "draft" || args.status === "void"
            ? undefined
            : inv.paid_at,
      updated_at: now,
    });
    return null;
  },
});

export const deleteInvoice = mutation({
  args: { invoiceId: v.id("engagement_invoices") },
  handler: async (ctx, args) => {
    const inv = await ownedInvoice(ctx, args.invoiceId);
    await ctx.db.delete(inv._id);
    return null;
  },
});

/**
 * Resumo de faturamento do engajamento: receita faturada (por status) × custo
 * de IA (usage_logs.by_engagement, só linhas com engagement_id denormalizado =
 * forward-only) → margem. Margem ignora câmbio (assume mesma moeda) — é
 * scaffold; precifica depois.
 */
export const getEngagementBilling = query({
  args: { engagementId: v.id("engagements") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const eng = await ctx.db.get(args.engagementId);
    if (!eng || eng.user_id !== identity.subject) return null;
    const clientDoc = await ctx.db.get(eng.client_id);

    const invoices = await ctx.db
      .query("engagement_invoices")
      .withIndex("by_engagement_and_created", (q) =>
        q.eq("engagement_id", args.engagementId),
      )
      .collect();
    let paid = 0;
    let sent = 0;
    let draft = 0;
    let currency = "USD";
    for (const inv of invoices) {
      currency = inv.currency || currency;
      if (inv.status === "paid") paid += inv.amount_dollars;
      else if (inv.status === "sent") sent += inv.amount_dollars;
      else if (inv.status === "draft") draft += inv.amount_dollars;
    }

    const costRows = await ctx.db
      .query("usage_logs")
      .withIndex("by_engagement", (q) =>
        q.eq("engagement_id", args.engagementId),
      )
      .take(INVOICE_COST_CAP);
    let cost = 0;
    for (const r of costRows) {
      cost +=
        typeof r.provider_billed_cost_dollars === "number"
          ? r.provider_billed_cost_dollars
          : r.cost_dollars;
    }

    const invoiced = paid + sent;
    return {
      clientId: eng.client_id,
      clientName: clientDoc?.name ?? "(cliente removido)",
      portalEnabled: clientDoc?.portal_enabled === true,
      currency,
      paid,
      sent,
      draft,
      invoiced,
      cost,
      margin: invoiced - cost,
      costCapped: costRows.length === INVOICE_COST_CAP,
      costRows: costRows.length,
      invoiceCount: invoices.length,
    };
  },
});
