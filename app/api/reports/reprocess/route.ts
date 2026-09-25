import { NextRequest, NextResponse } from "next/server";
import { tasks, auth, idempotencyKeys } from "@trigger.dev/sdk";
import { getInternalUser } from "@/lib/auth/require-internal";
import { getConvexClient } from "@/lib/db/convex-client";
import { api } from "@/convex/_generated/api";
import type { generateEngagementReport } from "@/trigger/report-generation";

export const runtime = "nodejs";

const TASK_ID = "generate-engagement-report";

/**
 * Reprocessa (redispara) a geração de um grupo de relatório existente — útil
 * quando o run ficou órfão (ex.: restart do worker). Reseta os formatos para a
 * fila e dispara a task de novo com chave de idempotência NOVA (força re-run).
 */
export async function POST(req: NextRequest) {
  const staff = await getInternalUser();
  if (!staff) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const serviceKey = process.env.CONVEX_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return NextResponse.json(
      { error: "Server not configured" },
      { status: 500 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const reportGroupId = body.reportGroupId;
  if (typeof reportGroupId !== "string") {
    return NextResponse.json(
      { error: "Parâmetros inválidos" },
      { status: 400 },
    );
  }

  const userId = staff.user.id;

  try {
    const params = await getConvexClient().mutation(
      api.reports.getReportGroupParamsBackend,
      { serviceKey, userId, reportGroupId },
    );
    if (!params) {
      return NextResponse.json(
        { error: "Relatório não encontrado" },
        { status: 404 },
      );
    }

    const idempotencyKey = await idempotencyKeys.create(
      [reportGroupId, "reprocess", String(Date.now())],
      { scope: "global" },
    );
    const handle = await tasks.trigger<typeof generateEngagementReport>(
      TASK_ID,
      {
        engagementId: params.engagementId,
        userId,
        audience: params.audience,
        formats: params.formats,
        reportGroupId,
        version: params.version,
        generatedBy: params.generatedBy,
      },
      { idempotencyKey, idempotencyKeyTTL: "6h" },
    );
    await getConvexClient().mutation(
      api.reports.setReportTriggerRunForBackend,
      {
        serviceKey,
        reportGroupId,
        triggerRunId: handle.id,
      },
    );
    const publicAccessToken = await auth.createPublicToken({
      scopes: { read: { runs: [handle.id] } },
      expirationTime: "6h",
    });
    return NextResponse.json({ runId: handle.id, publicAccessToken });
  } catch (error) {
    console.error("reprocess:", error);
    return NextResponse.json(
      { error: "Falha ao reprocessar" },
      { status: 500 },
    );
  }
}
