import { NextRequest, NextResponse } from "next/server";
import { getPortalSessionUser } from "@/lib/auth/require-portal";
import { getConvexClient } from "@/lib/db/convex-client";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Engajamentos de um cliente que o usuário tem acesso. O Convex nega por padrão
// (membership) — um clientId sem acesso volta lista vazia, nunca vaza.
export async function GET(req: NextRequest) {
  const u = await getPortalSessionUser();
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const serviceKey = process.env.CONVEX_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return NextResponse.json(
      { error: "Server not configured" },
      { status: 500 },
    );
  }
  const clientId = new URL(req.url).searchParams.get("clientId");
  if (!clientId) {
    return NextResponse.json({ error: "clientId ausente" }, { status: 400 });
  }
  const engagements = await getConvexClient().query(
    api.portal.listPortalEngagementsForBackend,
    { serviceKey, userId: u.id, clientId: clientId as Id<"clients"> },
  );
  return NextResponse.json({ engagements });
}
