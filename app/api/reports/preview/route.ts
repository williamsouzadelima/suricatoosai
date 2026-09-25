import { NextRequest, NextResponse } from "next/server";
import { getInternalUser } from "@/lib/auth/require-internal";
import { getConvexClient } from "@/lib/db/convex-client";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Conteúdo do relatório para PRÉVIA na tela (achados + evidência + imagens).
 * Gateado por getInternalUser; a chave de serviço nunca vai ao browser.
 */
export async function GET(req: NextRequest) {
  const staff = await getInternalUser();
  if (!staff) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const serviceKey = process.env.CONVEX_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return NextResponse.json(
      { error: "Server not configured" },
      { status: 500 },
    );
  }
  const engagementId = req.nextUrl.searchParams.get("engagementId");
  if (!engagementId) {
    return NextResponse.json(
      { error: "engagementId ausente" },
      { status: 400 },
    );
  }
  try {
    const preview = await getConvexClient().query(
      api.reports.getReportPreviewForBackend,
      {
        serviceKey,
        userId: staff.user.id,
        engagementId: engagementId as Id<"engagements">,
      },
    );
    return NextResponse.json({ preview });
  } catch (e) {
    console.error("report preview:", e);
    return NextResponse.json(
      { error: "Falha ao carregar prévia" },
      { status: 500 },
    );
  }
}
