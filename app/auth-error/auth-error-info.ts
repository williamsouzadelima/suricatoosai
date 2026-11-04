// Pure lookup for the auth-error page: maps a WorkOS error `code` to a message
// key (in the `authError` i18n namespace) and whether to auto-retry. Kept pure
// so it is unit-tested; the page/card do the rendering + translation.

export type AuthErrorKey =
  | "default"
  | "400"
  | "401"
  | "403"
  | "429"
  | "500"
  | "502"
  | "503"
  | "504";

const KNOWN_CODES: readonly AuthErrorKey[] = [
  "400",
  "401",
  "403",
  "429",
  "500",
  "502",
  "503",
  "504",
];

export function getAuthErrorInfo(code?: string | null): {
  key: AuthErrorKey;
  autoRetry: boolean;
} {
  const key =
    code && (KNOWN_CODES as readonly string[]).includes(code)
      ? (code as AuthErrorKey)
      : "default";
  // 500 is the only auto-retried code: it's usually a transient multi-tab
  // authenticate race, so a backoff retry tends to resolve it. Everything else
  // needs a deliberate user action, not a loop.
  return { key, autoRetry: key === "500" };
}
