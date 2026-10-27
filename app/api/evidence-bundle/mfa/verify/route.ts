import { NextRequest, NextResponse } from "next/server";
import { getInternalUser } from "@/lib/auth/require-internal";
import { evidenceBundleStepUpVerify } from "@/lib/mfa/verify-step-up";
import { STEP_UP_COOKIE } from "@/lib/mfa/step-up-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Step-up MFA (TOTP) do OPERADOR p/ baixar o bundle de evidências. Verifica o
 * código AGORA (WorkOS challenge+verify) e, em sucesso, grava a autorização
 * curta de uso único num cookie httpOnly ESCOPADO ao path exato do download
 * daquele engajamento (pra não valer p/ outro request/engajamento).
 */
export async function POST(req: NextRequest) {
  const staff = await getInternalUser();
  if (!staff) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

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
    actorKind: "internal",
    userId: staff.user.id,
    email: staff.user.email ?? undefined,
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
    path: `/api/evidence-bundle/${engagementId}/download`,
    maxAge: result.expSeconds,
  });
  return res;
}
