import { NextResponse } from "next/server";
import { getInternalUser } from "@/lib/auth/require-internal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "Sou staff interno?" — checagem leve para a UI do client (o app-switcher do
 * chat → shell do operador). O papel interno é por allowlist de e-mail
 * (server-only), então o client não deriva isso: pergunta aqui. Nunca vaza a
 * allowlist — responde só o booleano.
 */
export async function GET() {
  const staff = await getInternalUser();
  return NextResponse.json({ isStaff: !!staff });
}
