/**
 * RBAC interno da feature de engajamentos/relatórios (fail-closed, env-driven).
 *
 * Espelha a filosofia de lib/auth/superadmin.ts: o acesso ao painel interno
 * nunca depende dos dados que o painel gerencia. Dois níveis:
 *   - owner   → SUPERADMIN_EMAILS (controle total, incl. gestão de membership)
 *   - analyst → INTERNAL_ANALYST_EMAILS (gerir clientes/engajamentos/achados,
 *               capturar evidência, gerar relatórios)
 * Env vazio ⇒ null ⇒ sem acesso (fail-closed).
 */
import { getSuperadminEmails } from "@/lib/auth/superadmin";

export type InternalRole = "owner" | "analyst";

function getAnalystEmails(): string[] {
  return (process.env.INTERNAL_ANALYST_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.length > 0);
}

/** owner (superadmin) tem precedência sobre analyst. */
export function getInternalRole(
  email: string | null | undefined,
): InternalRole | null {
  if (!email) return null;
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;
  if (getSuperadminEmails().includes(normalized)) return "owner";
  if (getAnalystEmails().includes(normalized)) return "analyst";
  return null;
}

/** owner satisfaz qualquer minRole; analyst só satisfaz "analyst". */
export function roleSatisfies(
  role: InternalRole | null,
  minRole: InternalRole,
): boolean {
  if (role === "owner") return true;
  if (role === "analyst") return minRole === "analyst";
  return false;
}
