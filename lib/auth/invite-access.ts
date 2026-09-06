import { getConvexClient } from "@/lib/db/convex-client";
import { api } from "@/convex/_generated/api";
import { isSuperadmin } from "@/lib/auth/superadmin";

/**
 * Invite-only access gate (Phase 1).
 *
 * Enforced once per login in app/callback/route.ts. When INVITE_ONLY_ENABLED
 * is not "true", the gate is inert and behavior is identical to before.
 *
 * Fail-open: if Convex is unreachable or the service key is missing, we do NOT
 * lock users out (a backend blip must never regress everyone's access).
 * Superadmins are always allowed regardless of the allowlist.
 */

export function isInviteOnlyEnabled(): boolean {
  return process.env.INVITE_ONLY_ENABLED === "true";
}

export async function isAccessAllowed(
  email: string | null | undefined,
): Promise<boolean> {
  if (isSuperadmin(email)) return true;
  if (!email) return false;

  const serviceKey = process.env.CONVEX_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    console.warn(
      "[invite-access] CONVEX_SERVICE_ROLE_KEY not set — failing open",
    );
    return true;
  }

  try {
    const result = await getConvexClient().query(api.accessAllowlist.isAllowed, {
      serviceKey,
      email,
    });
    return result.allowed;
  } catch (error) {
    console.error(
      "[invite-access] allowlist check failed — failing open",
      error instanceof Error ? error.message : String(error),
    );
    return true;
  }
}

/** Best-effort: promote an "invited" entry to "active" on first successful login. */
export async function markAccessActive(
  email: string | null | undefined,
): Promise<void> {
  if (!email) return;
  const serviceKey = process.env.CONVEX_SERVICE_ROLE_KEY;
  if (!serviceKey) return;
  try {
    await getConvexClient().mutation(api.accessAllowlist.markActive, {
      serviceKey,
      email,
    });
  } catch (error) {
    console.warn(
      "[invite-access] markActive failed (non-fatal)",
      error instanceof Error ? error.message : String(error),
    );
  }
}
