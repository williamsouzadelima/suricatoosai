import { NextRequest, NextResponse } from "next/server";
import { getInternalUser } from "@/lib/auth/require-internal";
import { generateS3UploadUrl } from "@/convex/s3Utils";

export const runtime = "nodejs";

const CONTENT_TYPE = "application/octet-stream";
const MAX_BYTES = 200 * 1024 * 1024; // 200 MB

/**
 * URL S3 pré-assinada para o browser subir um BUNDLE de evidências (tar.gz/zip)
 * direto ao S3 (sem passar pelo servidor Next). Depois o browser chama
 * /api/engagements/ingest-bundle com o s3Key retornado.
 */
export async function POST(req: NextRequest) {
  const staff = await getInternalUser();
  if (!staff) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const filename =
    typeof body.filename === "string" ? body.filename : "bundle.tar.gz";
  const size = typeof body.size === "number" ? body.size : undefined;
  if (size !== undefined && size > MAX_BYTES) {
    return NextResponse.json(
      { error: "Bundle acima do limite (200 MB)." },
      { status: 400 },
    );
  }

  try {
    const { uploadUrl, s3Key } = await generateS3UploadUrl(
      filename,
      CONTENT_TYPE,
      staff.user.id,
      size,
    );
    return NextResponse.json({ uploadUrl, s3Key, contentType: CONTENT_TYPE });
  } catch (error) {
    console.error("bundle-upload-url:", error);
    return NextResponse.json(
      { error: "Falha ao gerar URL de upload" },
      { status: 500 },
    );
  }
}
