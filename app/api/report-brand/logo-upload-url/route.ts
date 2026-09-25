import { NextRequest, NextResponse } from "next/server";
import { getInternalUser } from "@/lib/auth/require-internal";
import { generateS3UploadUrl } from "@/convex/s3Utils";

export const runtime = "nodejs";

const ALLOWED = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * URL S3 pré-assinada para o browser subir o LOGO da marca direto ao S3. Depois
 * o browser chama POST /api/report-brand/logo com o s3Key + mediaType.
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
  const contentType =
    typeof body.contentType === "string" ? body.contentType : "image/png";
  if (!ALLOWED.includes(contentType)) {
    return NextResponse.json(
      { error: "Tipo de imagem não suportado (use PNG, JPEG, WEBP ou SVG)." },
      { status: 400 },
    );
  }
  const filename =
    typeof body.filename === "string" ? body.filename : "logo.png";
  const size = typeof body.size === "number" ? body.size : undefined;
  if (size !== undefined && size > MAX_BYTES) {
    return NextResponse.json(
      { error: "Logo acima do limite (5 MB)." },
      { status: 400 },
    );
  }

  try {
    const { uploadUrl, s3Key } = await generateS3UploadUrl(
      filename,
      contentType,
      staff.user.id,
      size,
    );
    return NextResponse.json({ uploadUrl, s3Key, contentType });
  } catch (error) {
    console.error("logo-upload-url:", error);
    return NextResponse.json(
      { error: "Falha ao gerar URL de upload" },
      { status: 500 },
    );
  }
}
