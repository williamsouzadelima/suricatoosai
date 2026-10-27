import { NextResponse } from "next/server";
import { getPortalSessionUser } from "@/lib/auth/require-portal";
import { getTotpFactorId } from "@/lib/mfa/workos-mfa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Se o CLIENTE já inscreveu um fator TOTP (a UI roteia inscrição vs código). */
export async function GET() {
  const u = await getPortalSessionUser();
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const factorId = await getTotpFactorId(u.id);
    return NextResponse.json({ enrolled: Boolean(factorId) });
  } catch (e) {
    console.error("mfa status (portal): falha ao listar fatores", e);
    return NextResponse.json({ error: "status_unavailable" }, { status: 502 });
  }
}
