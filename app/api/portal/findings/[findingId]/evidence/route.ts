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
  req: NextRequest,
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
  const convex = getConvexClient();
  const fid = findingId as Id<"findings">;
  const evidence = await convex.query(
    api.portal.listPortalEvidenceForFindingForBackend,
    { serviceKey, userId: u.id, findingId: fid },
  );
  // Auditoria durável (fail-closed): registra a visualização antes de servir.
  try {
    await convex.mutation(api.portal.recordPortalEvidenceViewForBackend, {
      serviceKey,
      userId: u.id,
      findingId: fid,
      count: evidence.length,
      actorEmail: u.email ?? undefined,
      ip:
        req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined,
      userAgent: req.headers.get("user-agent") ?? undefined,
    });
  } catch (e) {
    console.error("portal evidence: auditoria indisponível, recusando", e);
    return NextResponse.json(
      { error: "Auditoria indisponível" },
      { status: 503 },
    );
  }
  return NextResponse.json({ evidence });
}
