import { NextRequest, NextResponse } from "next/server";
import { getInternalUser } from "@/lib/auth/require-internal";
import { getConvexClient } from "@/lib/db/convex-client";
import { api } from "@/convex/_generated/api";

export const runtime = "nodejs";

async function guard() {
  const staff = await getInternalUser();
  if (!staff) {
    return {
      error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }
  const serviceKey = process.env.CONVEX_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return {
      error: NextResponse.json(
        { error: "Server not configured" },
        { status: 500 },
      ),
    };
  }
  return { staff, serviceKey };
}

/** Define o logo da marca a partir do s3Key já enviado (via presigned URL). */
export async function POST(req: NextRequest) {
  const g = await guard();
  if ("error" in g) return g.error;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const s3Key = typeof body.s3Key === "string" ? body.s3Key : "";
  const mediaType =
    typeof body.mediaType === "string" ? body.mediaType : undefined;
  // Só aceita objeto no prefixo do próprio usuário (evita referência arbitrária).
  if (!s3Key || !s3Key.startsWith(`users/${g.staff.user.id}/`)) {
    return NextResponse.json({ error: "s3Key inválido" }, { status: 400 });
  }
  try {
    await getConvexClient().mutation(api.reports.setReportBrandLogoForBackend, {
      serviceKey: g.serviceKey,
      userId: g.staff.user.id,
      s3Key,
      mediaType,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("report-brand logo set:", error);
    return NextResponse.json(
      { error: "Falha ao salvar logo" },
      { status: 500 },
    );
  }
}

/** Remove o logo da marca (volta ao wordmark/texto). */
export async function DELETE() {
  const g = await guard();
  if ("error" in g) return g.error;
  try {
    await getConvexClient().mutation(api.reports.setReportBrandLogoForBackend, {
      serviceKey: g.serviceKey,
      userId: g.staff.user.id,
      s3Key: "",
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("report-brand logo clear:", error);
    return NextResponse.json(
      { error: "Falha ao remover logo" },
      { status: 500 },
    );
  }
}
