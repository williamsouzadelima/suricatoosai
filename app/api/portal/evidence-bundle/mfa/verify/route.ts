import { NextRequest, NextResponse } from "next/server";
import { getPortalSessionUser } from "@/lib/auth/require-portal";
import { evidenceBundleStepUpVerify } from "@/lib/mfa/verify-step-up";
import { STEP_UP_COOKIE } from "@/lib/mfa/step-up-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Step-up MFA (TOTP) do CLIENTE (portal) p/ baixar o bundle de evidências. O
 * cliente é org-less no WorkOS, mas é usuário WorkOS → o fluxo por-fator funciona.
 * Cookie httpOnly escopado ao path do download do portal daquele engajamento.
 */
export async function POST(req: NextRequest) {
  const u = await getPortalSessionUser();
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { engagementId?: unknown; code?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const engagementId = typeof body.engagementId === "string" ? body.engagementId : "";
  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!engagementId || !code) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  const result = await evidenceBundleStepUpVerify({
    req,
    actorKind: "client",
    userId: u.id,
    email: u.email ?? undefined,
    engagementId,
    code,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(STEP_UP_COOKIE, result.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: `/api/portal/evidence-bundle/${engagementId}/download`,
    maxAge: result.expSeconds,
  });
  return res;
}
