/**
 * Client-safe invite-only flag (NEXT_PUBLIC, inlined at build time). Used to
 * hide self-registration UI (the "Sign up" / "Get started" CTAs) when the app
 * is invite-only. Access enforcement is server-side — see lib/auth/invite-access.ts
 * (callback gate) and app/signup/*.
 */
export function isInviteOnlyClient(): boolean {
  return process.env.NEXT_PUBLIC_INVITE_ONLY_ENABLED === "true";
}
