import { handleAuth } from "@workos-inc/authkit-nextjs";
import {
  getRecoverableAuthkitCallbackErrorBucket,
  type RecoverableAuthkitCallbackErrorBucket,
  withRecoverableAuthkitCallbackErrorSuppressed,
} from "@/lib/auth/authkit-callback-logging";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import {
  isInviteOnlyEnabled,
  isAccessAllowed,
  markAccessActive,
} from "@/lib/auth/invite-access";

// Atrás do reverse proxy (Caddy) em next dev, request.url resolve p/ localhost:3000.
// Usamos a base pública p/ todos os redirects de auth (senão o login cai em localhost).
const APP_BASE_URL =
  process.env.NEXT_PUBLIC_BASE_URL ?? "https://ai.suricatoos.com";

const isValidLocalPath = (path: string): boolean => {
  return (
    path.startsWith("/") && !path.startsWith("//") && !path.startsWith("/\\")
  );
};

const PKCE_COOKIE_PREFIX = "wos-auth-verifier";

const hasPkceCookie = (request: NextRequest): boolean =>
  request.cookies.getAll().some((c) => c.name.startsWith(PKCE_COOKIE_PREFIX));

type RecoveryBucket = RecoverableAuthkitCallbackErrorBucket | "unknown";

const classifyCallbackError = (error: unknown): RecoveryBucket => {
  return getRecoverableAuthkitCallbackErrorBucket(error) ?? "unknown";
};

const buildRecoveryResponse = async (
  request: NextRequest,
  error: unknown,
): Promise<Response> => {
  const cookieStore = await cookies();
  const redirectPath = cookieStore.get("post_login_redirect")?.value;
  const hasVerifierCookie = hasPkceCookie(request);
  if (redirectPath) {
    cookieStore.delete({ name: "post_login_redirect", path: "/" });
  }

  const bucket = classifyCallbackError(error);
  const rawReferer = request.headers.get("referer");
  let refererOrigin: string | null = null;
  if (rawReferer) {
    try {
      refererOrigin = new URL(rawReferer).origin;
    } catch {
      refererOrigin = null;
    }
  }
  const logPayload = {
    event: "auth.callback_invalid",
    bucket,
    hasVerifierCookie,
    userAgent: request.headers.get("user-agent"),
    refererOrigin,
    secFetchSite: request.headers.get("sec-fetch-site"),
  };

  // Distinct prefix from authkit's own `[AuthKit callback error]` so log
  // aggregators don't double-count and so we can grep this wrapper separately.
  if (bucket === "unknown") {
    console.error("[callback] unrecoverable", error, {
      ...logPayload,
      event: "auth.callback_failed",
    });
    return NextResponse.redirect(new URL("/auth-error?code=500", APP_BASE_URL));
  }

  if (bucket === "missing_auth_parameter") {
    console.info("[callback] invalid_request", logPayload);
  } else {
    console.warn("[callback] recovering", logPayload);
  }

  // Only verifier_missing with the cookie still present indicates genuine
  // corruption/tampering worth surfacing as an error. Everything else →
  // one-click recovery via /login.
  if (bucket === "verifier_missing" && hasVerifierCookie) {
    return NextResponse.redirect(
      new URL("/auth-error?code=400&reason=verifier_invalid", APP_BASE_URL),
    );
  }

  // Recoverable cases (stale flow, multi-tab, scanner prefetch, ITP,
  // cross-device link, embedded webview, missing cookie, duplicate callback,
  // expired sign-in session): one-click recovery.
  // Preserve post_login_redirect intent so the retry lands where they wanted.
  const loginUrl = new URL("/login", APP_BASE_URL);
  const loginResponse = NextResponse.redirect(loginUrl);
  if (redirectPath && isValidLocalPath(redirectPath)) {
    loginResponse.cookies.set("post_login_redirect", redirectPath, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 600,
      path: "/",
    });
  }
  return loginResponse;
};

// Created per-request (not module scope) so the captured email in onSuccess is
// never shared across concurrent callbacks.
const createAuthHandler = (
  onAuthSuccess: (email: string | undefined) => void,
) =>
  handleAuth({
    baseURL: APP_BASE_URL,
    onError: async ({ error, request }) => {
      return buildRecoveryResponse(request as NextRequest, error);
    },
    onSuccess: async ({ user }) => {
      onAuthSuccess(user?.email ?? undefined);
    },
  });

export async function GET(request: NextRequest) {
  // Short-circuit the single most common recoverable case — no PKCE cookie
  // at all (stale/abandoned flow, prefetch, ITP) — before authkit runs, so
  // authkit's unconditional `[AuthKit callback error]` console.error doesn't
  // fire. Kept intentionally minimal so it doesn't couple to authkit internals.
  if (!hasPkceCookie(request)) {
    return buildRecoveryResponse(
      request,
      new Error(
        "Auth cookie missing — cannot verify OAuth state. Ensure Set-Cookie headers are propagated on redirects.",
      ),
    );
  }

  const cookieStore = await cookies();
  const redirectPath = cookieStore.get("post_login_redirect")?.value;

  let authedEmail: string | undefined;
  const authHandler = createAuthHandler((email) => {
    authedEmail = email;
  });

  let response: NextResponse;
  try {
    // AuthKit logs known recoverable callback failures at error level before
    // onError can hand them to our warning-level recovery path.
    response = (await withRecoverableAuthkitCallbackErrorSuppressed(() =>
      authHandler(request),
    )) as NextResponse;
  } catch (error) {
    // Defensive: handleAuth shouldn't throw when onError is provided, but if
    // it ever does, fall back to the same recovery pipeline.
    return buildRecoveryResponse(request, error);
  }

  // Invite-only gate (Phase 1): block non-invited accounts at login. Inert
  // unless INVITE_ONLY_ENABLED === "true". Runs once per login. Fail-open:
  // isAccessAllowed returns true on backend errors so a blip never locks out,
  // and superadmins are always allowed.
  if (isInviteOnlyEnabled() && authedEmail !== undefined) {
    const allowed = await isAccessAllowed(authedEmail);
    if (!allowed) {
      console.warn(
        JSON.stringify({
          event: "auth.invite_gate_blocked",
          service: "hackerai-web",
          emailDomain: authedEmail.split("@")[1] ?? null,
        }),
      );
      const blocked = NextResponse.redirect(
        new URL("/access/not-invited", APP_BASE_URL),
      );
      // Clear the session authkit just established so the account has no access.
      blocked.cookies.delete("wos-session");
      return blocked;
    }
    // Allowed: promote an "invited" entry to "active" (best-effort).
    await markAccessActive(authedEmail);
  }

  // On a successful redirect response, always clear post_login_redirect so a
  // stale/malformed value can't survive and re-trigger the check on every
  // subsequent callback. Only rewrite the Location header if the value is a
  // safe local path. MUTATE authkit's response rather than building a new one
  // — rebuilding drops the Set-Cookie headers authkit attached to expire the
  // PKCE verifier, which causes `invalid_grant` on any subsequent hit of the
  // callback URL (refresh, back button, prefetcher).
  if (redirectPath && [302, 307].includes(response.status)) {
    cookieStore.delete({ name: "post_login_redirect", path: "/" });
    if (isValidLocalPath(redirectPath)) {
      response.headers.set(
        "location",
        new URL(redirectPath, APP_BASE_URL).toString(),
      );
    }
    return response;
  }

  if (response.status >= 400) {
    return NextResponse.redirect(
      new URL(`/auth-error?code=${response.status}`, APP_BASE_URL),
    );
  }

  return response;
}
