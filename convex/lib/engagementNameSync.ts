import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

/**
 * Sincronização de nome entre uma task (chat) e o seu engajamento.
 *
 * Regra (decidida com o William):
 *  - Só espelha quando o engajamento tem EXATAMENTE uma task anexada (1:1).
 *    Engajamentos que agrupam várias tasks mantêm nome próprio e independente
 *    — não são tocados (não quebra o agrupamento de `attachChatToEngagement`).
 *  - Bidirecional: renomear a task reflete no engajamento e vice-versa.
 *  - O auto-título do agente também espelha, MAS um rename manual do
 *    engajamento "trava" o nome (`engagements.name_locked`) e o auto-título
 *    deixa de sobrescrever a partir daí.
 */

export const MAX_TITLE = 100;

/** A única task anexada ao engajamento, ou null se houver 0 ou >1 (não é 1:1). */
export async function getSoleChatForEngagement(
  ctx: MutationCtx,
  engagementId: Id<"engagements">,
): Promise<Doc<"chats"> | null> {
  const rows = await ctx.db
    .query("chats")
    .withIndex("by_engagement_and_updated", (q) =>
      q.eq("engagement_id", engagementId),
    )
    .take(2);
  return rows.length === 1 ? rows[0] : null;
}

/**
 * Espelha o título de uma task no nome do seu engajamento (só no 1:1).
 * `manual=true` (rename explícito do usuário) também trava o nome do
 * engajamento contra sobrescrita futura pelo auto-título do agente.
 */
export async function syncEngagementNameFromChat(
  ctx: MutationCtx,
  chat: Doc<"chats">,
  newTitle: string,
  opts: { manual: boolean },
): Promise<void> {
  if (!chat.engagement_id) return;
  const sole = await getSoleChatForEngagement(ctx, chat.engagement_id);
  // Só sincroniza se ESTA task for a única do engajamento.
  if (!sole || sole._id !== chat._id) return;
  const eng = await ctx.db.get(chat.engagement_id);
  if (!eng) return;
  // Auto-título nunca sobrescreve um nome travado manualmente.
  if (!opts.manual && eng.name_locked) return;

  const name = newTitle.trim().slice(0, MAX_TITLE);
  if (!name) return;

  const patch: { name?: string; name_locked?: boolean; updated_at?: number } =
    {};
  if (name !== eng.name) patch.name = name;
  if (opts.manual && !eng.name_locked) patch.name_locked = true;
  // Evita escrita no-op (só updated_at) que invalidaria queries reativas à toa.
  if (patch.name === undefined && patch.name_locked === undefined) return;
  patch.updated_at = Date.now();
  await ctx.db.patch(eng._id, patch);
}

/**
 * Espelha o nome de um engajamento no título da sua única task (só no 1:1).
 * Sempre tratado como ação manual (vem de rename explícito do engajamento).
 */
export async function syncChatTitleFromEngagement(
  ctx: MutationCtx,
  engagementId: Id<"engagements">,
  newName: string,
): Promise<void> {
  const sole = await getSoleChatForEngagement(ctx, engagementId);
  if (!sole) return;
  const title = newName.trim().slice(0, MAX_TITLE);
  if (!title || title === sole.title) return;
  await ctx.db.patch(sole._id, { title, update_time: Date.now() });
}
