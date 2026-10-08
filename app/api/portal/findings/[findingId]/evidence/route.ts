import { NextRequest, NextResponse } from "next/server";
import { getPortalSessionUser } from "@/lib/auth/require-portal";
import { getConvexClient } from "@/lib/db/convex-client";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Evidência (TEXTO) de um achado PUBLICADO. O Convex re-resolve o cliente do
// próprio achado e nega por padrão (membership); só status "published".
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ findingId: string }> },
) {
  const u = await getPortalSessionUser();
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const serviceKey = process.env.CONVEX_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return NextResponse.json(
      { error: "Server not configured" },
      { status: 500 },
    );
  }
  const { findingId } = await params;
  const evidence = await getConvexClient().query(
    api.portal.listPortalEvidenceForFindingForBackend,
    {
      serviceKey,
      userId: u.id,
      findingId: findingId as Id<"findings">,
    },
  );
  return NextResponse.json({ evidence });
}
