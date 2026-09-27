import { withAuth } from "@workos-inc/authkit-nextjs";

/**
 * Usuário da sessão WorkOS para o PORTAL do cliente. Diferente de getInternalUser:
 * NÃO exige staff interno — qualquer sessão válida passa aqui, e a autorização
 * REAL (membership ativa + portal_enabled) é feita deny-by-default nas queries
 * Convex do portal (convex/portal.ts). Fail-closed (null em qualquer falha).
 *
 * Este helper só diz "há uma sessão"; ele NUNCA concede acesso a dado de cliente
 * sozinho. Toda rota do portal precisa resolver a membership do alvo.
 */
export async function getPortalSessionUser(): Promise<{
  id: string;
  email: string | null;
} | null> {
  try {
    const { user } = await withAuth();
    if (!user?.id) return null;
    return { id: user.id, email: user.email ?? null };
  } catch {
    return null;
  }
}
