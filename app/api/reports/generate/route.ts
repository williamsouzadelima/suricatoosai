import { NextRequest, NextResponse } from "next/server";
import { tasks, auth, idempotencyKeys } from "@trigger.dev/sdk";
import { getInternalUser } from "@/lib/auth/require-internal";
import { getConvexClient } from "@/lib/db/convex-client";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { generateEngagementReport } from "@/trigger/report-generation";

export const runtime = "nodejs";

const TASK_ID = "generate-engagement-report";
type Audience = "technical" | "executive" | "commercial";
type Format = "docx" | "pptx" | "pdf";
const AUDIENCES: readonly Audience[] = ["technical", "executive", "commercial"];
const FORMATS: readonly Format[] = ["docx", "pptx", "pdf"];

function isAudience(v: unknown): v is Audience {
  return typeof v === "string" && (AUDIENCES as readonly string[]).includes(v);
}

export async function POST(req: NextRequest) {
  const staff = await getInternalUser();
  if (!staff) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const serviceKey = process.env.CONVEX_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return NextResponse.json(
      { error: "Server not configured (CONVEX_SERVICE_ROLE_KEY)" },
      { status: 500 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const engagementId = body.engagementId;
  const audience = body.audience;
  const rawFormats = Array.isArray(body.formats) ? body.formats : [];
  const formats = rawFormats.filter((f): f is Format =>
    (FORMATS as readonly unknown[]).includes(f),
  );
  if (
    typeof engagementId !== "string" ||
    !isAudience(audience) ||
    formats.length === 0
  ) {
    return NextResponse.json(
      { error: "Parâmetros inválidos" },
      { status: 400 },
    );
  }

  const userId = staff.user.id;
  const generatedBy = staff.user.email ?? staff.user.id;

  try {
    const request = await getConvexClient().mutation(
      api.reports.createReportRequest,
      {
        serviceKey,
        userId,
        engagementId: engagementId as Id<"engagements">,
        audience,
        formats,
        generatedBy,
      },
    );

    const idempotencyKey = await idempotencyKeys.create(
      [
        engagementId,
        audience,
        [...formats].sort().join(","),
        String(request.version),
      ],
      { scope: "global" },
    );

    const handle = await tasks.trigger<typeof generateEngagementReport>(
      TASK_ID,
      {
        engagementId,
        userId,
        audience,
        formats,
        reportGroupId: request.reportGroupId,
        version: request.version,
        generatedBy,
      },
      { idempotencyKey, idempotencyKeyTTL: "6h" },
    );

    await getConvexClient().mutation(
      api.reports.setReportTriggerRunForBackend,
      {
        serviceKey,
        reportGroupId: request.reportGroupId,
        triggerRunId: handle.id,
      },
    );

    const publicAccessToken = await auth.createPublicToken({
      scopes: { read: { runs: [handle.id] } },
      expirationTime: "6h",
    });

    return NextResponse.json({
      reportGroupId: request.reportGroupId,
      version: request.version,
      runId: handle.id,
      publicAccessToken,
    });
  } catch (error) {
    console.error("Falha ao iniciar geração de relatório:", error);
    return NextResponse.json(
      { error: "Falha ao iniciar geração de relatório" },
      { status: 500 },
    );
  }
}
