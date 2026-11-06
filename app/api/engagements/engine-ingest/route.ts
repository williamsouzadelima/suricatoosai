import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

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
  cvssScore: z.number().optional(),
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

export async function POST(req: NextRequest) {
  // Sigilo: recurso invisível a menos que ligado E com token de máquina válido.
  if (!isEngineIngestEnabled()) return new NextResponse(null, { status: 404 });
  if (!verifyEngineToken(req.headers.get("x-engine-token"))) {
    return new NextResponse(null, { status: 404 });
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

  try {
    const uploads: ResolvedImageUpload[] = [];
    for (const img of ingest.images ?? []) {
      const file = form.get(img.field);
      if (!(file instanceof File)) {
        return NextResponse.json(
          { ok: false, error: "missing_image", field: img.field },
          { status: 400 },
        );
      }
      const mediaType = img.media_type || file.type || "image/png";
      if (!mediaType.startsWith("image/")) {
        return NextResponse.json(
          { ok: false, error: "not_image", field: img.field },
          { status: 400 },
        );
      }
      const ext = EXT_BY_MEDIA[mediaType] ?? "png";
      const bytes = Buffer.from(await file.arrayBuffer());
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
    // Nunca vazar internals/origem do motor no corpo; log só no servidor.
    console.error("engine-ingest failed", err);
    return NextResponse.json(
      { ok: false, error: "ingest_failed" },
      { status: 500 },
    );
  }
}
