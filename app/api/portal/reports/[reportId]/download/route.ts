import { NextRequest, NextResponse } from "next/server";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getPortalSessionUser } from "@/lib/auth/require-portal";
import { getUserIDWithFreshLoginContext } from "@/lib/auth/get-user-id";
import { getConvexClient } from "@/lib/db/convex-client";
import { getS3Client } from "@/convex/s3Utils";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  pdf: "application/pdf",
};

// Step-up: exige login recente (<= 15 min) antes de servir um relatório ao
// cliente. MFA real = política de org no WorkOS (fora do código).
const STEP_UP_MS = 15 * 60 * 1000;

/**
 * Download de relatório PELO PORTAL DO CLIENTE. Autoriza por MEMBERSHIP (nunca
 * por posse): getPortalReportForDownloadForBackend re-resolve o client_id do doc
 * e exige client_memberships ATIVA + portal_enabled. Step-up (login recente) +
 * auditoria fail-closed (actorKind "client") ANTES de servir. Proxy S3 (sem
 * bearer, sem presigned, sem share_id). Cache-Control: no-store.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ reportId: string }> },
) {
  const { reportId } = await params;
  const u = await getPortalSessionUser();
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const serviceKey = process.env.CONVEX_SERVICE_ROLE_KEY;
  const bucket = process.env.AWS_S3_BUCKET_NAME;
  if (!serviceKey || !bucket) {
    return NextResponse.json(
      { error: "Server not configured" },
      { status: 500 },
    );
  }

  // Step-up: login recente obrigatório.
  try {
    await getUserIDWithFreshLoginContext(req, STEP_UP_MS);
  } catch {
    return NextResponse.json(
      { error: "recent_login_required" },
      { status: 401 },
    );
  }

  const convex = getConvexClient();
  const userId = u.id;
  const actorEmail = u.email ?? undefined;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const userAgent = req.headers.get("user-agent") ?? undefined;
  const rid = reportId as Id<"reports">;

  const report = await convex.query(
    api.portal.getPortalReportForDownloadForBackend,
    { serviceKey, userId, reportId: rid },
  );

  if (!report || report.status !== "ready" || !report.s3Key) {
    try {
      await convex.mutation(api.securityAudit.recordSecurityEventForBackend, {
        serviceKey,
        eventType: "access.denied",
        actorUserId: userId,
        actorEmail,
        actorKind: "client",
        targetType: "report",
        targetId: reportId,
        ip,
        userAgent,
        outcome: "denied",
        detail: report ? `status=${report.status}` : "not_found_or_no_access",
      });
    } catch (e) {
      console.error("portal download: falha ao auditar negação", e);
    }
    return NextResponse.json(
      { error: "Relatório indisponível" },
      { status: 404 },
    );
  }

  // Fail-closed: auditoria ANTES de servir; se falhar, 503 (nunca entrega bytes).
  try {
    await convex.mutation(api.securityAudit.recordSecurityEventForBackend, {
      serviceKey,
      eventType: "report.downloaded",
      actorUserId: userId,
      actorEmail,
      actorKind: "client",
      clientId: report.clientId,
      engagementId: report.engagementId,
      organizationId: report.organizationId ?? undefined,
      targetType: "report",
      targetId: reportId,
      ip,
      userAgent,
      outcome: "success",
      detail: `${report.audience} v${report.version} ${report.format} (portal)`,
    });
  } catch (e) {
    console.error("portal download: auditoria indisponível, recusando", e);
    return NextResponse.json(
      { error: "Auditoria indisponível" },
      { status: 503 },
    );
  }

  try {
    const s3 = getS3Client();
    const obj = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: report.s3Key }),
    );
    const body = obj.Body as
      { transformToWebStream: () => ReadableStream } | undefined;
    if (!body) {
      return NextResponse.json({ error: "Objeto vazio" }, { status: 502 });
    }
    const filename = `${report.audience}_v${report.version}.${report.format}`;
    return new Response(body.transformToWebStream(), {
      headers: {
        "Content-Type": MIME[report.format] ?? "application/octet-stream",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("portal download: falha ao ler do S3", e);
    return NextResponse.json(
      { error: "Falha ao ler o arquivo" },
      { status: 502 },
    );
  }
}
