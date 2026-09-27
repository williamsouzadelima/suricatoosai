import { NextResponse } from "next/server";
import { getPortalSessionUser } from "@/lib/auth/require-portal";
import { getConvexClient } from "@/lib/db/convex-client";
import { api } from "@/convex/_generated/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Clientes que o usuário logado pode ver no portal (membership ativa +
// portal_enabled). Deny-by-default no Convex; aqui só resolve a sessão.
export async function GET() {
  const u = await getPortalSessionUser();
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const serviceKey = process.env.CONVEX_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return NextResponse.json(
      { error: "Server not configured" },
      { status: 500 },
    );
  }
  const clients = await getConvexClient().query(
    api.portal.listPortalClientsForBackend,
    { serviceKey, userId: u.id },
  );
  return NextResponse.json({ clients });
}
