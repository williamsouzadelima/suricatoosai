import { NextResponse } from "next/server";
import { getInternalUser } from "@/lib/auth/require-internal";
import { getTotpFactorId } from "@/lib/mfa/workos-mfa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Se o OPERADOR já inscreveu um fator TOTP (a UI roteia inscrição vs código). */
export async function GET() {
  const staff = await getInternalUser();
  if (!staff) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const factorId = await getTotpFactorId(staff.user.id);
    return NextResponse.json({ enrolled: Boolean(factorId) });
  } catch (e) {
    console.error("mfa status (operador): falha ao listar fatores", e);
    return NextResponse.json({ error: "status_unavailable" }, { status: 502 });
  }
}
