import { NextRequest, NextResponse } from "next/server";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getInternalUser } from "@/lib/auth/require-internal";
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

/**
 * Download de relatório por PROXY AUTENTICADO (não URL pré-assinada crua).
 *
 * - Autoriza por acesso interno (getInternalUser) + posse do relatório.
 * - Grava a AUDITORIA (security_audit_log) ANTES de servir os bytes; se a
 *   auditoria falhar, responde 503 e NUNCA entrega o arquivo (fail-closed).
 * - Faz stream do S3 GetObject; a credencial S3 nunca vai ao browser e não há
 *   bearer reutilizável. Cache-Control: no-store.
 *
 * v2 (portal): autorizar também client_memberships + step-up/MFA; bucket
 * dedicado/SSE-KMS. Ver [[stratihawkeye-security-program]] / plano.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ reportId: string }> },
) {
  const { reportId } = await params;
  // ?inline=1 → serve inline (prévia no navegador, ex.: PDF) em vez de anexo.
  const inline = req.nextUrl.searchParams.get("inline") === "1";
  const staff = await getInternalUser();
  if (!staff) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const serviceKey = process.env.CONVEX_SERVICE_ROLE_KEY;
  const bucket = process.env.AWS_S3_BUCKET_NAME;
  if (!serviceKey || !bucket) {
    return NextResponse.json(
      { error: "Server not configured" },
      { status: 500 },
    );
  }

  const convex = getConvexClient();
  const userId = staff.user.id;
  const actorEmail = staff.user.email ?? undefined;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const userAgent = req.headers.get("user-agent") ?? undefined;
  const rid = reportId as Id<"reports">;

  const report = await convex.query(api.reports.getReportForDownloadBackend, {
    serviceKey,
    userId,
    reportId: rid,
  });

  if (!report || report.status !== "ready" || !report.s3Key) {
    // Auditoria de acesso negado é best-effort (não bloqueia o 404).
    try {
      await convex.mutation(api.securityAudit.recordSecurityEventForBackend, {
        serviceKey,
        eventType: "access.denied",
        actorUserId: userId,
        actorEmail,
        actorKind: "internal",
        targetType: "report",
        targetId: reportId,
        ip,
        userAgent,
        outcome: "denied",
        detail: report ? `status=${report.status}` : "not_found",
      });
    } catch (e) {
      console.error("download: falha ao gravar auditoria de negação", e);
    }
    return NextResponse.json(
      { error: "Relatório indisponível" },
      { status: 404 },
    );
  }

  // Fail-closed: a auditoria do download é gravada ANTES de servir. Se falhar,
  // 503 — nunca entregar bytes sem trilha.
  try {
    await convex.mutation(api.securityAudit.recordSecurityEventForBackend, {
      serviceKey,
      eventType: "report.downloaded",
      actorUserId: userId,
      actorEmail,
      actorKind: "internal",
      clientId: report.clientId,
      engagementId: report.engagementId,
      organizationId: report.organizationId ?? undefined,
      targetType: "report",
      targetId: reportId,
      ip,
      userAgent,
      outcome: "success",
      detail: `${report.audience} v${report.version} ${report.format}`,
    });
  } catch (e) {
    console.error(
      "download: auditoria indisponível, recusando (fail-closed)",
      e,
    );
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
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("download: falha ao ler do S3", e);
    return NextResponse.json(
      { error: "Falha ao ler o arquivo" },
      { status: 502 },
    );
  }
}
