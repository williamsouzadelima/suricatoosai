import "server-only";

import { api } from "@/convex/_generated/api";
import { ChatSDKError } from "@/lib/errors";
import { getConvexClient } from "@/lib/db/convex-client";
import { getSuspensionMessage } from "@/lib/suspensionMessage";

const serviceKey = process.env.CONVEX_SERVICE_ROLE_KEY!;

// Categorias de suspensão por SEGURANÇA/abuso — para elas, além de bloquear,
// matamos as sessões WorkOS do usuário (o bloqueio sozinho não revoga o token).
const SESSION_KILL_CATEGORIES = new Set([
  "admin_manual",
  "dispute_fraudulent",
  "support_confirmed_fraud",
]);

/** Invariante testável: só matamos sessão para suspensão de segurança/abuso. */
export function shouldKillSessions(category: string): boolean {
  return SESSION_KILL_CATEGORIES.has(category);
}

/**
 * Mata as sessões WorkOS do usuário (fire-and-forget, best-effort) quando a
 * suspensão é de segurança. Reativo: dispara quando o usuário suspenso bate num
 * guard — um atacante ativo tem a sessão revogada no próximo request. NUNCA lança.
 */
function killSessionsIfSecurity(userId: string, category: string): void {
  if (!shouldKillSessions(category)) return;
  void (async () => {
    try {
      const { workos } = await import("@/app/api/workos");
      const sessions = await workos.userManagement.listSessions(userId);
      await Promise.allSettled(
        sessions.data.map((s) =>
          workos.userManagement.revokeSession({ sessionId: s.id }),
        ),
      );
    } catch (e) {
      console.warn("[suspensions] revoke de sessão falhou (não-fatal)", e);
    }
  })();
}

export async function getActiveSuspensionForUser(userId: string) {
  return await getConvexClient().query(api.userSuspensions.getActiveByUser, {
    serviceKey,
    userId,
  });
}

export async function getActiveChatAccessBlockForUser(userId: string) {
  return await getConvexClient().query(
    api.userSuspensions.getActiveChatAccessBlockByUser,
    {
      serviceKey,
      userId,
    },
  );
}

export async function assertUserCanMakeCostIncurringRequest(userId: string) {
  const suspension = await getActiveSuspensionForUser(userId);
  if (!suspension) return;

  killSessionsIfSecurity(userId, suspension.category);
  throw new ChatSDKError(
    "forbidden:chat",
    getSuspensionMessage(`${suspension.category}:${suspension.source_id}`),
    {
      suspensionCategory: suspension.category,
      suspensionSource: suspension.source,
    },
  );
}

export async function assertUserCanAccessChatHistory(userId: string) {
  const suspension = await getActiveChatAccessBlockForUser(userId);
  if (!suspension) return;

  killSessionsIfSecurity(userId, suspension.category);
  throw new ChatSDKError(
    "forbidden:chat",
    getSuspensionMessage(`${suspension.category}:${suspension.source_id}`),
    {
      suspensionCategory: suspension.category,
      suspensionSource: suspension.source,
    },
  );
}
