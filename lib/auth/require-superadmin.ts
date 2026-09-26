import { withAuth } from "@workos-inc/authkit-nextjs";
import { isSuperadmin } from "@/lib/auth/superadmin";
import { recordUserDenial } from "@/lib/security/user-detector";

type AuthedUser = NonNullable<Awaited<ReturnType<typeof withAuth>>["user"]>;

/**
 * Resolve the current session user only if they are a configured superadmin
 * (SUPERADMIN_EMAILS). Returns null otherwise. Use in /admin server components
 * and admin API route handlers.
 */
export async function getSuperadminUser(): Promise<AuthedUser | null> {
  try {
    const { user } = await withAuth();
    if (!user) return null;
    if (!isSuperadmin(user.email)) {
      // Usuário autenticado NÃO-superadmin batendo em rota de admin = sinal de
      // ataque (fire-and-forget; staff é filtrado no detector).
      recordUserDenial(user.id, user.email);
      return null;
    }
    return user;
  } catch {
    return null;
  }
}
