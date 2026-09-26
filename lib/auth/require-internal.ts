import { withAuth } from "@workos-inc/authkit-nextjs";
import {
  getInternalRole,
  roleSatisfies,
  type InternalRole,
} from "@/lib/auth/internal-roles";
import { recordUserDenial } from "@/lib/security/user-detector";

type AuthedUser = NonNullable<Awaited<ReturnType<typeof withAuth>>["user"]>;

/**
 * Resolve o usuário da sessão só se for staff interno (owner/analyst) com nível
 * >= minRole. Fail-closed (retorna null em qualquer falha). Usar em server
 * components /clients & /engagements e nas rotas app/api/{clients,engagements,
 * reports,evidence}. Espelha getSuperadminUser (lib/auth/require-superadmin).
 *
 * NOTA: este é o guard do Next (defesa em profundidade). A aplicação real de
 * tenancy nos dados é o wrapper withTenantScope (convex/lib/tenantGuards), que
 * verifica internal_staff/client_memberships no Convex.
 */
export async function getInternalUser(
  minRole: InternalRole = "analyst",
): Promise<{ user: AuthedUser; role: InternalRole } | null> {
  try {
    const { user } = await withAuth();
    if (!user) return null;
    const role = getInternalRole(user.email);
    if (!role || !roleSatisfies(role, minRole)) {
      // Usuário autenticado sem papel interno batendo em rota interna = sinal de
      // ataque (fire-and-forget; staff é filtrado no detector).
      recordUserDenial(user.id, user.email);
      return null;
    }
    return { user, role };
  } catch {
    return null;
  }
}
