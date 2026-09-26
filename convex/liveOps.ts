import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { validateServiceKey } from "./lib/utils";

/**
 * Operação ao vivo para o /admin (serviceKey). Runs de agente EM EXECUÇÃO agora,
 * cruzando os usuários com presença recente (user_presence) e seus chats com
 * active_trigger_run_id. LIMITAÇÃO honesta: só enxerga runs de usuários com
 * presença na janela (não há índice global de active_trigger_run_id ainda); um
 * run cujo dono fechou a aba há muito tempo pode não aparecer. Kill switch
 * (adminCancelRunForBackend) reusa o mesmo caminho do cancelStreamFromClient.
 */

const PRESENCE_SCAN_CAP = 500;
const RUNS_CAP = 200;

export const getLiveRunsForBackend = query({
  args: { serviceKey: v.string(), nowMs: v.number(), windowMs: v.number() },
  returns: v.object({
    runs: v.array(
      v.object({
        userId: v.string(),
        chatId: v.string(),
        title: v.string(),
        runId: v.string(),
        updatedAt: v.number(),
      }),
    ),
    scannedUsers: v.number(),
  }),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const cutoff = args.nowMs - args.windowMs;
    const present = await ctx.db
      .query("user_presence")
      .withIndex("by_last_seen", (q) => q.gte("last_seen_at", cutoff))
      .order("desc")
      .take(PRESENCE_SCAN_CAP);

    const runs: {
      userId: string;
      chatId: string;
      title: string;
      runId: string;
      updatedAt: number;
    }[] = [];
    for (const p of present) {
      const active = await ctx.db
        .query("chats")
        .withIndex("by_user_and_active_trigger_run", (q) =>
          q.eq("user_id", p.user_id).gt("active_trigger_run_id", ""),
        )
        .collect();
      for (const chat of active) {
        if (!chat.active_trigger_run_id) continue;
        runs.push({
          userId: chat.user_id,
          chatId: chat.id,
          title: chat.title || "(sem título)",
          runId: chat.active_trigger_run_id,
          updatedAt: chat.update_time ?? chat._creationTime,
        });
        if (runs.length >= RUNS_CAP) break;
      }
      if (runs.length >= RUNS_CAP) break;
    }
    runs.sort((a, b) => b.updatedAt - a.updatedAt);
    return { runs, scannedUsers: present.length };
  },
});

/**
 * Kill switch do operador: aborta um run por chatId (qualquer usuário). Espelha
 * cancelStreamFromClient mas com serviceKey (a rota gateia por getSuperadminUser).
 * Marca o chat como cancelado e publica a cancelation no Redis para o worker
 * parar. Idempotente/benigno se o chat não existe.
 */
export const adminCancelRunForBackend = mutation({
  args: { serviceKey: v.string(), chatId: v.string() },
  returns: v.object({ ok: v.boolean(), canceled: v.boolean() }),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const chat = await ctx.db
      .query("chats")
      .withIndex("by_chat_id", (q) => q.eq("id", args.chatId))
      .first();
    if (!chat) return { ok: true, canceled: false };

    // Espelha cancelStreamFromClient (caminho PROVADO): limpa active_stream_id +
    // canceled_at e publica a cancelation no Redis. NÃO mexe em
    // active_trigger_run_id — o worker o limpa ao parar (evita corrida com o
    // finalize da task do trigger).
    const wasRunning = chat.active_stream_id !== undefined;
    const canceledAt = Date.now();
    await ctx.db.patch(chat._id, {
      active_stream_id: undefined,
      canceled_at: canceledAt,
      finish_reason: undefined,
      update_time: canceledAt,
      ...(wasRunning ? { last_run_finished_at: canceledAt } : {}),
    });
    await ctx.scheduler.runAfter(0, internal.redisPubsub.publishCancellation, {
      chatId: args.chatId,
      skipSave: false,
    });
    return { ok: true, canceled: wasRunning };
  },
});
