import { query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { validateServiceKey } from "./lib/utils";

/**
 * Suporte à captura RETROATIVA de achados de uma task (chat) já concluída.
 *
 * - getChatTranscriptForBackend: transcrição achatada (papel + texto/saídas de
 *   ferramenta, com clamp por mensagem) para o job de extração por IA ler.
 *   serviceKey + posse por user_id (o chat é do analista).
 * - listRecentChatsForCapture: lista os chats recentes do usuário (identity)
 *   para a UI escolher qual anexar/capturar; devolve engagement_id p/ marcar os
 *   já anexados.
 */

const MAX_MSGS = 400;
const PER_MSG_CLAMP = 4000;
const TOOL_OUTPUT_CLAMP = 2000;
const TOOL_INPUT_CLAMP = 400;

function toText(value: unknown, clamp: number): string {
  if (value == null) return "";
  const s = typeof value === "string" ? value : JSON.stringify(value);
  return s.length > clamp ? s.slice(0, clamp) + "…" : s;
}

/** Extrai o texto de saída de uma tool part do AI SDK (formatos variados). */
function toolOutputText(
  part: Record<string, unknown>,
  clamp: number = TOOL_OUTPUT_CLAMP,
): string {
  const out = part.output ?? part.result;
  if (out == null) return "";
  if (typeof out === "string") return toText(out, clamp);
  if (typeof out === "object") {
    const value = (out as Record<string, unknown>).value ?? out;
    return toText(value, clamp);
  }
  return toText(out, clamp);
}

/** Achata content + parts numa string legível e limitada. */
function flattenMessage(
  m: Doc<"messages">,
  perMsgClamp: number = PER_MSG_CLAMP,
  toolClamp: number = TOOL_OUTPUT_CLAMP,
): string {
  const chunks: string[] = [];
  if (typeof m.content === "string" && m.content.trim()) {
    chunks.push(m.content.trim());
  }
  const parts = Array.isArray(m.parts) ? m.parts : [];
  for (const raw of parts) {
    if (!raw || typeof raw !== "object") continue;
    const p = raw as Record<string, unknown>;
    const t = typeof p.type === "string" ? p.type : "";
    if (t === "text" && typeof p.text === "string") {
      if (p.text.trim()) chunks.push(p.text.trim());
    } else if (t === "reasoning") {
      // Ignora raciocínio (economiza orçamento do prompt/tela).
      continue;
    } else if (t.startsWith("tool-") || t === "dynamic-tool") {
      const name =
        typeof p.toolName === "string"
          ? p.toolName
          : t.replace(/^tool-/, "") || "tool";
      const input = p.input ? toText(p.input, TOOL_INPUT_CLAMP) : "";
      const output = toolOutputText(p, toolClamp);
      chunks.push(
        `[ferramenta ${name}]${input ? ` entrada: ${input}` : ""}${
          output ? `\nsaída: ${output}` : ""
        }`,
      );
    }
  }
  const joined = chunks.join("\n");
  return joined.length > perMsgClamp
    ? joined.slice(0, perMsgClamp) + "…"
    : joined;
}

const VIEW_PER_MSG_CLAMP = 8000;
const VIEW_TOOL_CLAMP = 4000;

/**
 * Transcrição de uma task para EXIBIÇÃO na UI do engajamento (identity + posse).
 * Read-only, achatada e limitada; para fidelidade total o usuário abre /c/[id].
 */
export const getChatTranscriptForView = query({
  args: { chatId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const chat = await ctx.db
      .query("chats")
      .withIndex("by_chat_id", (q) => q.eq("id", args.chatId))
      .first();
    if (!chat || chat.user_id !== identity.subject) return null;
    const limit = Math.min(Math.max(args.limit ?? MAX_MSGS, 1), 500);
    const msgs = await ctx.db
      .query("messages")
      .withIndex("by_chat_id", (q) => q.eq("chat_id", args.chatId))
      .order("asc")
      .take(limit);
    const messages = msgs
      .filter((m) => !m.is_hidden && m.role !== "system")
      .map((m) => ({
        role: m.role,
        id: m.id,
        text: flattenMessage(m, VIEW_PER_MSG_CLAMP, VIEW_TOOL_CLAMP),
      }))
      .filter((m) => m.text.length > 0);
    return {
      title: chat.title,
      messageCount: messages.length,
      messages,
    };
  },
});

export const getChatTranscriptForBackend = query({
  args: {
    serviceKey: v.string(),
    userId: v.string(),
    chatId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const chat = await ctx.db
      .query("chats")
      .withIndex("by_chat_id", (q) => q.eq("id", args.chatId))
      .first();
    if (!chat || chat.user_id !== args.userId) {
      throw new ConvexError({ code: "ACCESS_DENIED", message: "Sem acesso" });
    }
    const limit = Math.min(Math.max(args.limit ?? MAX_MSGS, 1), 500);
    const msgs = await ctx.db
      .query("messages")
      .withIndex("by_chat_id", (q) => q.eq("chat_id", args.chatId))
      .order("asc")
      .take(limit);
    const messages = msgs
      .filter((m) => !m.is_hidden && m.role !== "system")
      .map((m) => ({ role: m.role, id: m.id, text: flattenMessage(m) }))
      .filter((m) => m.text.length > 0);
    return {
      title: chat.title,
      engagementId: chat.engagement_id ?? null,
      messageCount: messages.length,
      messages,
    };
  },
});

export const listRecentChatsForCapture = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const limit = Math.min(Math.max(args.limit ?? 60, 1), 100);
    const chats = await ctx.db
      .query("chats")
      .withIndex("by_user_and_updated", (q) =>
        q.eq("user_id", identity.subject),
      )
      .order("desc")
      .take(limit);
    return chats
      .filter((c) => !c.deletion_started_at)
      .map((c) => ({
        id: c.id,
        title: c.title,
        updateTime: c.last_run_finished_at ?? c._creationTime,
        engagementId: c.engagement_id ?? null,
        finishReason: c.finish_reason ?? null,
        active: !!c.active_trigger_run_id,
      }));
  },
});
