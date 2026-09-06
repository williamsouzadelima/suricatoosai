/**
 * Superadmin allowlist for the /admin control panel.
 *
 * Configured via the `SUPERADMIN_EMAILS` env var (comma-separated list of
 * emails). Superadmins bypass the invite-only access gate and are the only
 * accounts allowed into /admin and the admin APIs.
 *
 * Kept intentionally env-driven (not a DB table) so access to the control
 * panel never depends on the very data the panel manages.
 */

export function getSuperadminEmails(): string[] {
  return (process.env.SUPERADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.length > 0);
}

export function isSuperadmin(email: string | null | undefined): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  return getSuperadminEmails().includes(normalized);
}
