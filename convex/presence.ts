import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { validateServiceKey } from "./lib/utils";

/**
 * Heartbeat de presença no browser. Chamado pelo GlobalState a cada ~45s
 * enquanto a aba está visível. Upsert por user_id (WorkOS identity.subject, o
 * mesmo id que aparece em usage_logs e na lista de usuários do /admin). Mutation
 * pode usar Date.now() (só queries precisam ser determinísticas).
 */
export const beatPresence = mutation({
  args: { path: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const userId = identity.subject;
    const now = Date.now();
    const existing = await ctx.db
      .query("user_presence")
      .withIndex("by_user", (q) => q.eq("user_id", userId))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        last_seen_at: now,
        path: args.path,
        updated_at: now,
      });
    } else {
      await ctx.db.insert("user_presence", {
        user_id: userId,
        last_seen_at: now,
        path: args.path,
        updated_at: now,
      });
    }
    return null;
  },
});

const PRESENCE_CAP = 500;

/**
 * Presença para o /admin (serviceKey). Classifica cada usuário recente como
 * "online" (visto há < onlineMs) ou "idle" (< idleMs). nowMs vem da rota Node —
 * a query não é reativa, então a presença "expira" naturalmente a cada fetch,
 * sem precisar de cron de sweep. Lê pelo índice by_last_seen (bounded).
 */
export const getPresenceForBackend = query({
  args: {
    serviceKey: v.string(),
    nowMs: v.number(),
    onlineMs: v.number(),
    idleMs: v.number(),
  },
  returns: v.object({
    online: v.number(),
    idle: v.number(),
    users: v.array(
      v.object({
        userId: v.string(),
        lastSeenAt: v.number(),
        status: v.union(v.literal("online"), v.literal("idle")),
        path: v.union(v.string(), v.null()),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const cutoff = args.nowMs - args.idleMs;
    const rows = await ctx.db
      .query("user_presence")
      .withIndex("by_last_seen", (q) => q.gte("last_seen_at", cutoff))
      .order("desc")
      .take(PRESENCE_CAP);

    let online = 0;
    let idle = 0;
    const users = rows.map((r) => {
      const status: "online" | "idle" =
        args.nowMs - r.last_seen_at < args.onlineMs ? "online" : "idle";
      if (status === "online") online += 1;
      else idle += 1;
      return {
        userId: r.user_id,
        lastSeenAt: r.last_seen_at,
        status,
        path: r.path ?? null,
      };
    });

    return { online, idle, users };
  },
});
