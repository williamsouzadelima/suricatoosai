import { NextRequest, NextResponse } from "next/server";
import { getPortalSessionUser } from "@/lib/auth/require-portal";
import { getConvexClient } from "@/lib/db/convex-client";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Achados PUBLICADOS de um engajamento. O Convex re-resolve o cliente do
// engajamento e nega por padrão (membership); só status "published".
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
  const engagementId = new URL(req.url).searchParams.get("engagementId");
  if (!engagementId) {
    return NextResponse.json(
      { error: "engagementId ausente" },
      { status: 400 },
    );
  }
  const convex = getConvexClient();
  const eid = engagementId as Id<"engagements">;
  const findings = await convex.query(api.portal.listPortalFindingsForBackend, {
    serviceKey,
    userId: u.id,
    engagementId: eid,
  });
  // Auditoria durável (fail-closed): registra a listagem antes de servir.
  try {
    await convex.mutation(api.portal.recordPortalFindingsViewForBackend, {
      serviceKey,
      userId: u.id,
      engagementId: eid,
      count: findings.length,
      actorEmail: u.email ?? undefined,
      ip:
        req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined,
      userAgent: req.headers.get("user-agent") ?? undefined,
    });
  } catch (e) {
    console.error("portal findings: auditoria indisponível, recusando", e);
    return NextResponse.json(
      { error: "Auditoria indisponível" },
      { status: 503 },
    );
  }
  return NextResponse.json({ findings });
}
