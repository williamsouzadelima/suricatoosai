import { NextRequest, NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getInternalUser } from "@/lib/auth/require-internal";
import { getConvexClient } from "@/lib/db/convex-client";
import { getS3Client } from "@/convex/s3Utils";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const execFileAsync = promisify(execFile);

/**
 * Prévia INLINE de relatório, pixel-a-pixel:
 * - PDF → serve o próprio PDF inline.
 * - DOCX/PPTX → converte para PDF via LibreOffice headless no host (cacheado no
 *   S3 em <s3Key>.preview.pdf) e serve o PDF inline.
 * Autoriza por getInternalUser + posse; grava auditoria antes de servir.
 */
async function bodyToBytes(obj: {
  Body?: { transformToByteArray: () => Promise<Uint8Array> };
}): Promise<Uint8Array | null> {
  const b = obj.Body;
  if (!b) return null;
  return await b.transformToByteArray();
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ reportId: string }> },
) {
  const { reportId } = await params;
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
  const rid = reportId as Id<"reports">;
  const report = await convex.query(api.reports.getReportForDownloadBackend, {
    serviceKey,
    userId,
    reportId: rid,
  });
  if (!report || report.status !== "ready" || !report.s3Key) {
    return NextResponse.json(
      { error: "Relatório indisponível" },
      { status: 404 },
    );
  }

  // Fail-closed: auditoria antes de servir (mesma política do download).
  try {
    await convex.mutation(api.securityAudit.recordSecurityEventForBackend, {
      serviceKey,
      eventType: "report.downloaded",
      actorUserId: userId,
      actorEmail: staff.user.email ?? undefined,
      actorKind: "internal",
      clientId: report.clientId,
      engagementId: report.engagementId,
      organizationId: report.organizationId ?? undefined,
      targetType: "report",
      targetId: reportId,
      ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
      userAgent: req.headers.get("user-agent") ?? undefined,
      outcome: "success",
      detail: `${report.audience} v${report.version} ${report.format} (prévia)`,
    });
  } catch (e) {
    console.error("view: auditoria indisponível, recusando", e);
    return NextResponse.json(
      { error: "Auditoria indisponível" },
      { status: 503 },
    );
  }

  const s3 = getS3Client();
  const inlineHeaders = (name: string) => ({
    "Content-Type": "application/pdf",
    "Content-Disposition": `inline; filename="${name}"`,
    "Cache-Control": "no-store",
  });
  const baseName = `${report.audience}_v${report.version}`;

  try {
    // PDF: serve direto.
    if (report.format === "pdf") {
      const obj = await s3.send(
        new GetObjectCommand({ Bucket: bucket, Key: report.s3Key }),
      );
      const bytes = await bodyToBytes(obj);
      if (!bytes) return NextResponse.json({ error: "Vazio" }, { status: 502 });
      return new Response(Buffer.from(bytes), {
        headers: inlineHeaders(`${baseName}.pdf`),
      });
    }

    // DOCX/PPTX: cache no S3 (<s3Key>.preview.pdf) ou converte via LibreOffice.
    const cacheKey = `${report.s3Key}.preview.pdf`;
    try {
      const cached = await s3.send(
        new GetObjectCommand({ Bucket: bucket, Key: cacheKey }),
      );
      const bytes = await bodyToBytes(cached);
      if (bytes) {
        return new Response(Buffer.from(bytes), {
          headers: inlineHeaders(`${baseName}.pdf`),
        });
      }
    } catch {
      // sem cache → converte abaixo
    }

    const src = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: report.s3Key }),
    );
    const srcBytes = await bodyToBytes(src);
    if (!srcBytes)
      return NextResponse.json({ error: "Vazio" }, { status: 502 });

    const work = await mkdtemp(join(tmpdir(), "rptview-"));
    try {
      const inPath = join(work, `in.${report.format}`);
      await writeFile(inPath, Buffer.from(srcBytes));
      await execFileAsync(
        "/usr/bin/soffice",
        [
          "--headless",
          "--norestore",
          "--convert-to",
          "pdf",
          "--outdir",
          work,
          `-env:UserInstallation=file://${work}/profile`,
          inPath,
        ],
        { timeout: 90_000, env: { ...process.env, HOME: "/root" } },
      );
      const pdf = await readFile(join(work, "in.pdf"));
      // Cacheia (best-effort — não bloqueia a resposta se falhar).
      s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: cacheKey,
          Body: pdf,
          ContentType: "application/pdf",
        }),
      ).catch((e) => console.error("view: falha ao cachear prévia", e));
      return new Response(pdf, { headers: inlineHeaders(`${baseName}.pdf`) });
    } finally {
      await rm(work, { recursive: true, force: true }).catch(() => {});
    }
  } catch (e) {
    console.error("view: falha ao gerar prévia", e);
    return NextResponse.json(
      { error: "Falha ao gerar prévia" },
      { status: 502 },
    );
  }
}
