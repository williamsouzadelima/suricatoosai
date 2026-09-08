import { getConvexClient } from "@/lib/db/convex-client";
import { api } from "@/convex/_generated/api";

/**
 * Registra uma ação do /admin no log de auditoria. Best-effort: nunca quebra a
 * ação principal (a auditoria é secundária). Chamado pelas rotas superadmin.
 */
export async function recordAudit(
  actor: string | null | undefined,
  action: string,
  target?: string,
  detail?: string,
): Promise<void> {
  const serviceKey = process.env.CONVEX_SERVICE_ROLE_KEY;
  if (!serviceKey) return;
  try {
    await getConvexClient().mutation(api.auditLog.record, {
      serviceKey,
      actor: actor ?? "desconhecido",
      action,
      target,
      detail,
    });
  } catch (error) {
    console.warn(
      "[audit] falha ao registrar (não-fatal)",
      error instanceof Error ? error.message : String(error),
    );
  }
}
