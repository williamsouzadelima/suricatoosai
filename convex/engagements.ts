import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { validateServiceKey } from "./lib/utils";
import { requireOwnedDoc } from "./lib/tenantGuards";
import {
  MAX_TITLE,
  syncChatTitleFromEngagement,
} from "./lib/engagementNameSync";

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
  // Tenancy centralizada em lib/tenantGuards (mesmos erros UNAUTHORIZED/
  // ACCESS_DENIED). Mantém a interface { identity, engagement }.
  const { identity, doc } = await requireOwnedDoc(ctx, engagementId);
  return { identity, engagement: doc };
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

/**
 * Backend (serviceKey, sem ctx.auth): escopo + janela de autorização de um
 * engajamento, p/ injetar no contexto do agente durante o run (agent-long).
 * Posse checada explicitamente (eng.user_id === userId); projeção mínima;
 * null se id inválido, inexistente ou de outro analista.
 */
export const getEngagementScopeForBackend = query({
  args: {
    serviceKey: v.string(),
    userId: v.string(),
    engagementId: v.string(),
  },
  returns: v.union(
    v.object({
      name: v.string(),
      scope: v.optional(v.array(scopeItemArg)),
      starts_at: v.optional(v.number()),
      ends_at: v.optional(v.number()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const id = ctx.db.normalizeId("engagements", args.engagementId);
    if (!id) return null;
    const eng = await ctx.db.get(id);
    if (!eng || eng.user_id !== args.userId) return null;
    return {
      name: eng.name,
      scope: eng.scope,
      starts_at: eng.starts_at,
      ends_at: eng.ends_at,
    };
  },
});

// ── Reavaliações agendadas (recorrência de assessment) ──────────────────────
// UMA linha por engajamento em `scheduled_assessments` (patch-in-place,
// re-armada). UI = auth (posse via assertOwnedEngagement); dispatcher =
// *ForBackend (serviceKey). Estados: active -> dispatching (lease claimed_at)
// -> active (re-arma: next_run_at += intervalo) | paused (operador OU janela de
// autorização expirada). O dispatcher só cria um RASCUNHO (chat vinculado +
// pending_prompt semeado), NÃO executa nada — o lançamento é o envio do
// operador. Correções sob recorrência (vs o one-shot de scheduled_campaigns):
// `claimed_at` é LEASE com reaper no claim (série não morre se o dispatcher
// cair); markResult GUARDADO (só re-arma se ainda "dispatching").
const SA_DAY_MS = 24 * 60 * 60 * 1000;
const SA_DEFAULT_LEASE_MS = 5 * 60 * 1000; // re-claim de "dispatching" após 5 min
const SA_MIN_INTERVAL_DAYS = 1;
const SA_MAX_INTERVAL_DAYS = 365;

export const getScheduleForEngagement = query({
  args: { engagementId: v.id("engagements") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const eng = await ctx.db.get(args.engagementId);
    if (!eng || eng.user_id !== identity.subject) return null;
    const row = await ctx.db
      .query("scheduled_assessments")
      .withIndex("by_engagement", (q) =>
        q.eq("engagement_id", args.engagementId),
      )
      .first();
    if (!row) return null;
    return {
      status: row.status,
      interval_days: row.interval_days,
      next_run_at: row.next_run_at,
      last_dispatched_at: row.last_dispatched_at,
      last_chat_id: row.last_chat_id,
      last_status: row.last_status,
      last_error: row.last_error,
    };
  },
});

export const setScheduleForEngagement = mutation({
  args: {
    engagementId: v.id("engagements"),
    intervalDays: v.number(),
    nextRunAt: v.number(),
  },
  handler: async (ctx, args) => {
    const { identity } = await assertOwnedEngagement(ctx, args.engagementId);
    if (
      !Number.isFinite(args.intervalDays) ||
      args.intervalDays < SA_MIN_INTERVAL_DAYS ||
      args.intervalDays > SA_MAX_INTERVAL_DAYS
    ) {
      throw new ConvexError({
        code: "INVALID",
        message: `Intervalo deve ficar entre ${SA_MIN_INTERVAL_DAYS} e ${SA_MAX_INTERVAL_DAYS} dias`,
      });
    }
    if (!Number.isFinite(args.nextRunAt)) {
      throw new ConvexError({ code: "INVALID", message: "Data inválida" });
    }
    const now = Date.now();
    const intervalDays = Math.round(args.intervalDays);
    const existing = await ctx.db
      .query("scheduled_assessments")
      .withIndex("by_engagement", (q) =>
        q.eq("engagement_id", args.engagementId),
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        interval_days: intervalDays,
        next_run_at: args.nextRunAt,
        status: "active",
        updated_at: now,
      });
    } else {
      await ctx.db.insert("scheduled_assessments", {
        engagement_id: args.engagementId,
        user_id: identity.subject,
        interval_days: intervalDays,
        next_run_at: args.nextRunAt,
        status: "active",
        created_by: identity.subject,
        created_at: now,
        updated_at: now,
      });
    }
    return null;
  },
});

export const pauseScheduleForEngagement = mutation({
  args: { engagementId: v.id("engagements"), paused: v.boolean() },
  handler: async (ctx, args) => {
    await assertOwnedEngagement(ctx, args.engagementId);
    const row = await ctx.db
      .query("scheduled_assessments")
      .withIndex("by_engagement", (q) =>
        q.eq("engagement_id", args.engagementId),
      )
      .first();
    if (!row) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Sem agendamento" });
    }
    // Pausa de active OU dispatching: se um ciclo estiver em andamento, o guard
    // de markResultForBackend (status !== "dispatching" -> no-op) impede o
    // re-arm, então pausar no meio realmente para a série.
    if (args.paused) {
      if (row.status === "active" || row.status === "dispatching") {
        await ctx.db.patch(row._id, {
          status: "paused",
          claimed_at: undefined,
          updated_at: Date.now(),
        });
      }
    } else if (row.status === "paused") {
      await ctx.db.patch(row._id, { status: "active", updated_at: Date.now() });
    }
    return null;
  },
});

export const removeScheduleForEngagement = mutation({
  args: { engagementId: v.id("engagements") },
  handler: async (ctx, args) => {
    await assertOwnedEngagement(ctx, args.engagementId);
    const row = await ctx.db
      .query("scheduled_assessments")
      .withIndex("by_engagement", (q) =>
        q.eq("engagement_id", args.engagementId),
      )
      .first();
    if (row) await ctx.db.delete(row._id);
    return null;
  },
});

/**
 * Reclama atomicamente a próxima reavaliação vencida (active -> dispatching +
 * lease) OU reaproveita uma "dispatching" com lease vencido (dispatcher morto
 * no meio). Chamada em laço pelo dispatcher até `found` ser false.
 */
export const claimNextDueForBackend = mutation({
  args: {
    serviceKey: v.string(),
    nowMs: v.optional(v.number()),
    leaseMs: v.optional(v.number()),
  },
  returns: v.object({
    found: v.boolean(),
    id: v.optional(v.id("scheduled_assessments")),
    engagementId: v.optional(v.id("engagements")),
    userId: v.optional(v.string()),
    intervalDays: v.optional(v.number()),
  }),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const now = args.nowMs ?? Date.now();
    const leaseMs = args.leaseMs ?? SA_DEFAULT_LEASE_MS;
    // 1) active vencida (FIFO por next_run_at).
    let row: Doc<"scheduled_assessments"> | null = await ctx.db
      .query("scheduled_assessments")
      .withIndex("by_status_and_time", (q) =>
        q.eq("status", "active").lte("next_run_at", now),
      )
      .first();
    // 2) senão, reaper: "dispatching" com lease vencido.
    if (!row) {
      const stuck = await ctx.db
        .query("scheduled_assessments")
        .withIndex("by_status_and_time", (q) => q.eq("status", "dispatching"))
        .take(20);
      row = stuck.find((r) => (r.claimed_at ?? 0) <= now - leaseMs) ?? null;
    }
    if (!row) return { found: false };
    await ctx.db.patch(row._id, {
      status: "dispatching",
      claimed_at: now,
      updated_at: now,
    });
    return {
      found: true,
      id: row._id,
      engagementId: row.engagement_id,
      userId: row.user_id,
      intervalDays: row.interval_days,
    };
  },
});

/**
 * Fecha um ciclo reclamado. GUARDADO: só age se a linha ainda está
 * "dispatching". dispatched/failed re-arma (+intervalo); expired PAUSA (janela
 * de autorização vencida; exige o operador estender a janela).
 */
export const markResultForBackend = mutation({
  args: {
    serviceKey: v.string(),
    id: v.id("scheduled_assessments"),
    outcome: v.union(
      v.literal("dispatched"),
      v.literal("failed"),
      v.literal("expired"),
    ),
    chatId: v.optional(v.string()),
    error: v.optional(v.string()),
    nowMs: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const row = await ctx.db.get(args.id);
    if (!row || row.status !== "dispatching") return null;
    const now = args.nowMs ?? Date.now();
    if (args.outcome === "expired") {
      await ctx.db.patch(args.id, {
        status: "paused",
        claimed_at: undefined,
        last_status: "authorization_expired",
        updated_at: now,
      });
      return null;
    }
    const dispatched = args.outcome === "dispatched";
    await ctx.db.patch(args.id, {
      status: "active",
      next_run_at: now + row.interval_days * SA_DAY_MS,
      claimed_at: undefined,
      last_dispatched_at: dispatched ? now : row.last_dispatched_at,
      last_chat_id: dispatched ? args.chatId : row.last_chat_id,
      last_status: dispatched ? "ok" : "failed",
      last_error: dispatched ? undefined : (args.error ?? "erro"),
      updated_at: now,
    });
    return null;
  },
});

/**
 * Prepara o chat-rascunho da reavaliação (serviceKey): fixa o modo agente e
 * semeia o `pending_prompt` que o composer pré-preenche ao abrir. Valida posse
 * do chat (anti cross-tenant). Não dispara nada.
 */
export const setReassessmentDraftFieldsForBackend = mutation({
  args: {
    serviceKey: v.string(),
    chatId: v.string(),
    userId: v.string(),
    pendingPrompt: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
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
    await ctx.db.patch(chat._id, {
      pending_prompt: args.pendingPrompt,
      default_model_slug: "agent-long",
      update_time: Date.now(),
    });
    return null;
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
      // Criação manual = nome definido pelo usuário → travado contra o
      // auto-título de uma task que venha a ser anexada 1:1 depois.
      name_locked: true,
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
    let renamedTo: string | null = null;
    if (args.name !== undefined) {
      const name = args.name.trim();
      if (!name) {
        throw new ConvexError({ code: "INVALID", message: "Nome vazio" });
      }
      if (name.length > MAX_TITLE) {
        throw new ConvexError({
          code: "INVALID",
          message: `Nome não pode exceder ${MAX_TITLE} caracteres`,
        });
      }
      patch.name = name;
      // Rename manual do engajamento trava o nome contra o auto-título da task.
      patch.name_locked = true;
      renamedTo = name;
    }
    if (args.code !== undefined) patch.code = args.code.trim() || undefined;
    if (args.status !== undefined) patch.status = args.status;
    if (args.scope !== undefined) patch.scope = args.scope;
    if (args.startsAt !== undefined) patch.starts_at = args.startsAt;
    if (args.endsAt !== undefined) patch.ends_at = args.endsAt;
    await ctx.db.patch(args.engagementId, patch);
    // Rename manual do engajamento → reflete no título da task vinculada (1:1).
    if (renamedTo !== null) {
      await syncChatTitleFromEngagement(ctx, args.engagementId, renamedTo);
    }
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
  // Tenancy centralizada em lib/tenantGuards (mesmos erros). engagement_invoices
  // carrega user_id diretamente.
  const { doc } = await requireOwnedDoc(ctx, invoiceId);
  return doc;
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

    const budget = await ctx.db
      .query("engagement_budgets")
      .withIndex("by_engagement", (q) =>
        q.eq("engagement_id", args.engagementId),
      )
      .first();

    const invoiced = paid + sent;
    return {
      clientId: eng.client_id,
      clientName: clientDoc?.name ?? "(cliente removido)",
      portalEnabled: clientDoc?.portal_enabled === true,
      capDollars: budget?.cap_dollars ?? 0,
      warnPct: budget?.warn_pct ?? 80,
      enforce: budget?.enforce === true,
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

/**
 * Define/atualiza o teto de gasto de IA do engajamento. identity + posse.
 * cap_dollars=0 remove o teto (sem monitor). enforce=false (default) = só
 * MONITOR; enforce=true = bloqueia INICIAR novos runs quando o gasto >= teto
 * (Camada A no lib/budget-guard.ts; nunca corta run em andamento).
 */
export const setEngagementBudget = mutation({
  args: {
    engagementId: v.id("engagements"),
    capDollars: v.number(),
    warnPct: v.optional(v.number()),
    enforce: v.optional(v.boolean()),
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
    const cap = Number.isFinite(args.capDollars)
      ? Math.max(0, args.capDollars)
      : 0;
    const warn = Number.isFinite(args.warnPct ?? 80)
      ? Math.min(100, Math.max(0, args.warnPct ?? 80))
      : 80;
    const now = Date.now();
    const existing = await ctx.db
      .query("engagement_budgets")
      .withIndex("by_engagement", (q) =>
        q.eq("engagement_id", args.engagementId),
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        cap_dollars: cap,
        warn_pct: warn,
        enforce: args.enforce === true,
        note: args.note?.slice(0, 500),
        updated_by: identity.subject,
        updated_at: now,
      });
    } else {
      await ctx.db.insert("engagement_budgets", {
        user_id: identity.subject,
        organization_id: eng.organization_id,
        client_id: eng.client_id,
        engagement_id: args.engagementId,
        cap_dollars: cap,
        warn_pct: warn,
        enforce: args.enforce === true,
        note: args.note?.slice(0, 500),
        updated_by: identity.subject,
        updated_at: now,
      });
    }
    return null;
  },
});
