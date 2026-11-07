import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getConvexClient } from "@/lib/db/convex-client";
import { captureEngineFinding } from "@/lib/engine/capture";
import { isEngineIngestEnabled, verifyEngineToken } from "@/lib/engine/config";
import { mapEngineFinding, normalizeSeverity } from "@/lib/engine/map-finding";
import type { ResolvedImageUpload } from "@/lib/engine/types";
import { uploadEngineImage } from "@/lib/engine/upload-image";

/**
 * Endpoint de ingestão do motor autônomo (codinome). O sidecar que roda ao lado
 * do motor faz POST multipart: um campo `payload` (JSON do achado) + um campo
 * por imagem de evidência (bytes). O endpoint sobe as imagens, mapeia e grava
 * pelo seam provado (captureFindingForBackend, draft).
 *
 * Sigilo + zero-retrocesso: com ENGINE_INGEST_ENABLED!="true" OU token inválido,
 * responde 404 — o recurso é invisível e o platform segue idêntico ao de hoje.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const textEvidenceSchema = z.object({
  label: z.string().min(1),
  snippet: z.string().optional(),
  source_type: z.enum(["http", "tool_output", "command", "note"]).optional(),
  command: z.string().optional(),
  result_summary: z.string().optional(),
  step_index: z.number().int().optional(),
  tool_name: z.string().optional(),
});

const imageMetaSchema = z.object({
  field: z.string().min(1),
  label: z.string().min(1),
  media_type: z.string().optional(),
  step_index: z.number().int().optional(),
  tool_name: z.string().optional(),
  command: z.string().optional(),
  result_summary: z.string().optional(),
  surface: z.string().optional(),
});

const ingestSchema = z.object({
  engineTaskId: z.string().optional(),
  engineFindingId: z.string().optional(),
  engagementId: z.string().min(1),
  userId: z.string().min(1),
  title: z.string().min(1),
  affectedAsset: z.string().min(1),
  weaknessClass: z.string().min(1),
  severity: z.string().min(1),
  description: z.string().optional(),
  impact: z.string().optional(),
  remediation: z.string().optional(),
  narrative: z.string().optional(),
  reproductionSteps: z.array(z.string()).optional(),
  cwe: z.string().optional(),
  cvssVector: z.string().optional(),
  cvssScore: z.number().min(0).max(10).optional(),
  confidence: z.enum(["low", "medium", "high"]).optional(),
  textEvidence: z.array(textEvidenceSchema).optional(),
  images: z.array(imageMetaSchema).optional(),
});

const EXT_BY_MEDIA: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

function safeField(field: string): string {
  return field.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64) || "img";
}

const serviceKey = process.env.CONVEX_SERVICE_ROLE_KEY!;

// #5 DoS: tetos antes/durante a materialização do multipart.
const MAX_BODY_BYTES = 64 * 1024 * 1024; // 64 MB
const MAX_IMAGES = 12;

// #6: só imagem RASTER, e o tipo vem dos BYTES (magic number), não do
// media_type declarado — defeat SVG-com-script e type-confusion.
function sniffImageMediaType(b: Buffer): string | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47)
    return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38)
    return "image/gif";
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  )
    return "image/webp";
  return null;
}

// #10 SIGILO (backstop no platform): rejeita o ingest se qualquer texto contiver
// um termo proibido (nome interno do motor/ferramenta). Os termos REAIS vêm por
// env ENGINE_FORBIDDEN_TERMS (fora do git, por sigilo); defaults são placeholders.
function forbiddenTerms(): string[] {
  const env = (process.env.ENGINE_FORBIDDEN_TERMS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const defaults = ["exampleengine", "exampletool"];
  return [...new Set([...defaults, ...env])];
}
function scanForbiddenTerms(ingest: z.infer<typeof ingestSchema>): boolean {
  const terms = forbiddenTerms();
  if (terms.length === 0) return false;
  const parts: (string | undefined)[] = [
    ingest.title,
    ingest.description,
    ingest.narrative,
    ingest.impact,
    ingest.remediation,
    ingest.affectedAsset,
    ingest.weaknessClass,
    ...(ingest.reproductionSteps ?? []),
    ...(ingest.textEvidence ?? []).flatMap((t) => [
      t.label,
      t.snippet,
      t.result_summary,
      t.command,
    ]),
    ...(ingest.images ?? []).flatMap((i) => [i.label, i.result_summary, i.command]),
  ];
  const hay = parts.filter(Boolean).join("\n").toLowerCase();
  return terms.some((t) => hay.includes(t));
}

export async function POST(req: NextRequest) {
  // Sigilo: recurso invisível a menos que ligado E com token de máquina válido.
  if (!isEngineIngestEnabled()) return new NextResponse(null, { status: 404 });
  if (!verifyEngineToken(req.headers.get("x-engine-token"))) {
    return new NextResponse(null, { status: 404 });
  }

  // #5 DoS: rejeita corpo gigante ANTES de materializar o multipart.
  const contentLength = Number(req.headers.get("content-length") || "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return NextResponse.json(
      { ok: false, error: "payload_too_large" },
      { status: 413 },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_form" }, { status: 400 });
  }

  const payloadRaw = form.get("payload");
  if (typeof payloadRaw !== "string") {
    return NextResponse.json(
      { ok: false, error: "missing_payload" },
      { status: 400 },
    );
  }

  let ingest: z.infer<typeof ingestSchema>;
  try {
    ingest = ingestSchema.parse(JSON.parse(payloadRaw));
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_payload" },
      { status: 400 },
    );
  }

  // Severidade é validada cedo para distinguir erro de cliente (400) de falha
  // inesperada (500) adiante.
  try {
    normalizeSeverity(ingest.severity);
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_severity", value: ingest.severity },
      { status: 400 },
    );
  }

  // #10 SIGILO: nunca grava um achado que contenha termo proibido (nome interno
  // do motor/ferramenta). Resposta genérica — não ecoa o termo.
  if (scanForbiddenTerms(ingest)) {
    return NextResponse.json(
      { ok: false, error: "forbidden_term" },
      { status: 400 },
    );
  }

  // #5 DoS: teto de nº de imagens.
  if ((ingest.images ?? []).length > MAX_IMAGES) {
    return NextResponse.json(
      { ok: false, error: "too_many_images" },
      { status: 400 },
    );
  }

  // #4 cross-tenant: valida POSSE do engajamento ANTES de qualquer escrita no S3
  // (portador do token não grava no namespace de outro cliente). Id malformado/
  // inexistente/de-outro-dono/hard-deletado → 404 (sem revelar), nunca 500.
  try {
    const owner = await getConvexClient().query(
      api.engagements.getEngagementOwnerForBackend,
      { serviceKey, engagementId: ingest.engagementId as Id<"engagements"> },
    );
    if (!owner || owner.userId !== ingest.userId || owner.hardDeletedAt) {
      return new NextResponse(null, { status: 404 });
    }
  } catch {
    return new NextResponse(null, { status: 404 });
  }

  try {
    const uploads: ResolvedImageUpload[] = [];
    const uploadedFields = new Set<string>();
    for (const img of ingest.images ?? []) {
      // #5: um upload por field ÚNICO (mesmo field citado N vezes não gera N PUTs).
      if (uploadedFields.has(img.field)) continue;
      uploadedFields.add(img.field);
      const file = form.get(img.field);
      if (!(file instanceof File)) {
        return NextResponse.json(
          { ok: false, error: "missing_image", field: img.field },
          { status: 400 },
        );
      }
      const bytes = Buffer.from(await file.arrayBuffer());
      // #6: confia nos BYTES, não no media_type declarado — só raster conhecido.
      const mediaType = sniffImageMediaType(bytes);
      if (!mediaType) {
        return NextResponse.json(
          { ok: false, error: "unsupported_media_type", field: img.field },
          { status: 400 },
        );
      }
      const ext = EXT_BY_MEDIA[mediaType] ?? "png";
      const up = await uploadEngineImage({
        userId: ingest.userId,
        name: `${safeField(img.field)}.${ext}`,
        mediaType,
        bytes,
      });
      uploads.push({
        field: img.field,
        file_id: up.file_id,
        s3_key: up.s3_key,
        media_type: up.media_type,
      });
    }

    const mapped = mapEngineFinding(ingest, uploads);
    const result = await captureEngineFinding(mapped);
    if (!result.success) {
      return NextResponse.json(
        { ok: false, error: result.error ?? "capture_failed" },
        { status: 422 },
      );
    }
    return NextResponse.json({
      ok: true,
      merged: result.merged ?? false,
      finding_id: result.finding_id,
      images: uploads.length,
    });
  } catch (err) {
    // #11: nunca logar o erro cru (pode conter args/conteúdo de cliente). Só um
    // resumo seguro (classe/código do erro) — nada de message/stack/payload.
    const name = err instanceof Error ? err.name : "UnknownError";
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code?: unknown }).code)
        : undefined;
    console.error("engine-ingest failed", { name, code });
    return NextResponse.json(
      { ok: false, error: "ingest_failed" },
      { status: 500 },
    );
  }
}
