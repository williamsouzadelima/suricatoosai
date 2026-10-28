import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { validateServiceKey } from "./lib/utils";

/**
 * Reavaliações agendadas (recorrência de assessment). UMA linha por
 * engajamento (patch-in-place, re-armada a cada ciclo). As funções de UI são
 * auth-gated (posse por analista); o dispatcher usa as *ForBackend (serviceKey).
 *
 * Estados: active (armada) -> dispatching (reclamada, com lease `claimed_at`)
 * -> active (re-armada: next_run_at += intervalo) | paused (operador OU janela
 * de autorização expirada). O dispatcher NÃO executa nada — só cria um RASCUNHO
 * (chat vinculado + escopo semeado, não enviado) que o operador lança.
 *
 * Decisões vindas da análise do padrão de campanhas (hazards sob recorrência):
 * - `claimed_at` é um LEASE: um dispatcher morto no meio deixa a linha em
 *   "dispatching"; o claim reaproveita leases vencidos (reaper embutido). Sem
 *   isso, a série morreria em silêncio (nunca re-arma).
 * - `markResultForBackend` é GUARDADO (read-then-check status === "dispatching")
 *   pra um markResult atrasado de um ciclo anterior não re-armar por cima.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LEASE_MS = 5 * 60 * 1000; // re-claim de "dispatching" após 5 min
const MIN_INTERVAL_DAYS = 1;
const MAX_INTERVAL_DAYS = 365;

async function assertOwnedEngagement(
  ctx: QueryCtx | MutationCtx,
  engagementId: Id<"engagements">,
) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new ConvexError({ code: "UNAUTHORIZED", message: "Unauthorized" });
  }
  const eng = await ctx.db.get(engagementId);
  if (!eng || eng.user_id !== identity.subject) {
    throw new ConvexError({
      code: "ACCESS_DENIED",
      message: "Engajamento inexistente ou sem acesso",
    });
  }
  return identity;
}

// ── UI (auth-gated) ─────────────────────────────────────────────────────────

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
    const identity = await assertOwnedEngagement(ctx, args.engagementId);
    if (
      !Number.isFinite(args.intervalDays) ||
      args.intervalDays < MIN_INTERVAL_DAYS ||
      args.intervalDays > MAX_INTERVAL_DAYS
    ) {
      throw new ConvexError({
        code: "INVALID",
        message: `Intervalo deve ficar entre ${MIN_INTERVAL_DAYS} e ${MAX_INTERVAL_DAYS} dias`,
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
    // re-arm, então pausar no meio realmente para a série (um último rascunho
    // pode escapar se o dispatcher já estava criando-o).
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

// ── Dispatcher (serviceKey) ───────────────────────────────────────────────

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
    const leaseMs = args.leaseMs ?? DEFAULT_LEASE_MS;

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
 * "dispatching" (um markResult atrasado de outro ciclo não re-arma por cima).
 * - dispatched/failed: re-arma (next_run_at += intervalo).
 * - expired: PAUSA (não re-arma) — janela de autorização vencida; exige o
 *   operador estender a janela pra retomar.
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
      next_run_at: now + row.interval_days * DAY_MS,
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
