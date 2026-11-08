import { NextRequest, NextResponse } from "next/server";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getInternalUser } from "@/lib/auth/require-internal";
import { getConvexClient } from "@/lib/db/convex-client";
import { getS3Client } from "@/convex/s3Utils";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  contentDispositionFor,
  inlineSafeContentType,
} from "@/lib/utils/media-disposition";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Serve a imagem de uma EVIDÊNCIA (print/artefato) inline, autenticado por
 * getInternalUser + posse. Faz stream do S3; a credencial nunca vai ao browser.
 * Usado por <img src="/api/evidence/{id}/image"> na tela do achado.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ evidenceId: string }> },
) {
  const { evidenceId } = await params;
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

  try {
    const meta = await getConvexClient().query(
      api.findings.getEvidenceFileForBackend,
      {
        serviceKey,
        userId: staff.user.id,
        evidenceId: evidenceId as Id<"evidence">,
      },
    );
    if (!meta || !meta.s3Key) {
      return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
    }

    const s3 = getS3Client();
    const obj = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: meta.s3Key }),
    );
    const body = obj.Body as
      { transformToWebStream: () => ReadableStream } | undefined;
    if (!body) {
      return NextResponse.json({ error: "Objeto vazio" }, { status: 502 });
    }
    // Defesa same-origin: pina o Content-Type ao tipo canônico seguro quando
    // inline-safe (raster/pdf) — consistente com a disposição e com a doc de
    // media-disposition; senão usa o rótulo/fallback (a disposição será attachment).
    // nosniff impede o browser de adivinhar o tipo. Ingest de evidência é
    // raster-only por allowlist de extensão.
    const pinnedContentType = inlineSafeContentType(meta.mediaType);
    return new Response(body.transformToWebStream(), {
      headers: {
        "Content-Type":
          pinnedContentType ||
          meta.mediaType ||
          obj.ContentType ||
          "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": contentDispositionFor(meta.mediaType),
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (e) {
    console.error("evidence image:", e);
    return NextResponse.json({ error: "Falha ao ler imagem" }, { status: 502 });
  }
}
