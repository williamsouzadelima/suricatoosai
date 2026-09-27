import { NextRequest, NextResponse } from "next/server";
import { getPortalSessionUser } from "@/lib/auth/require-portal";
import { getConvexClient } from "@/lib/db/convex-client";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Relatórios PRONTOS de um engajamento. O Convex re-resolve o cliente do
// engajamento e nega por padrão (membership).
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
  const reports = await getConvexClient().query(
    api.portal.listPortalReportsForBackend,
    {
      serviceKey,
      userId: u.id,
      engagementId: engagementId as Id<"engagements">,
    },
  );
  return NextResponse.json({ reports });
}
