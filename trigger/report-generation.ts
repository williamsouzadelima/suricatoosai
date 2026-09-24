import { schemaTask } from "@trigger.dev/sdk";
import { metadata } from "@trigger.dev/sdk";
import { ConvexHttpClient } from "convex/browser";
import { Sandbox } from "@e2b/code-interpreter";
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { buildReportModel } from "@/lib/reports/build-report-model";
import type { ReportInput } from "@/lib/reports/report-model";
import type { Id } from "@/convex/_generated/dataModel";
import { RENDERER_SOURCES } from "../packages/report-renderer/sources";

export const REPORT_GENERATION_TASK_ID = "generate-engagement-report";

const EXT: Record<string, string> = { docx: "docx", pptx: "pptx", pdf: "pdf" };
const MIME: Record<string, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  pdf: "application/pdf",
};

const payloadSchema = z.object({
  engagementId: z.string().min(1),
  userId: z.string().min(1),
  audience: z.enum(["technical", "executive", "commercial"]),
  formats: z.array(z.enum(["docx", "pptx", "pdf"])).min(1),
  reportGroupId: z.string().min(1),
  version: z.number().int().positive(),
  generatedBy: z.string().min(1),
});

function getClient() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
  const serviceKey = process.env.CONVEX_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceKey) {
    throw new Error(
      "NEXT_PUBLIC_CONVEX_URL e CONVEX_SERVICE_ROLE_KEY são obrigatórios",
    );
  }
  return { client: new ConvexHttpClient(url), serviceKey };
}

function getS3() {
  const region = process.env.AWS_S3_REGION;
  const accessKeyId = process.env.AWS_S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_S3_SECRET_ACCESS_KEY;
  const bucket = process.env.AWS_S3_BUCKET_NAME;
  if (!region || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error("Config S3 ausente (AWS_S3_*)");
  }
  const endpoint = process.env.AWS_S3_ENDPOINT?.trim();
  const s3 = new S3Client({
    region,
    credentials: { accessKeyId, secretAccessKey },
    ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
  });
  return { s3, bucket };
}

export const generateEngagementReport = schemaTask({
  id: REPORT_GENERATION_TASK_ID,
  schema: payloadSchema,
  maxDuration: 20 * 60,
  machine: { preset: "small-1x" },
  run: async (payload) => {
    const { client, serviceKey } = getClient();
    const { s3, bucket } = getS3();

    // 1) Insumo (só achados aprovados/publicados).
    const input = await client.query(api.reports.getReportInputForBackend, {
      serviceKey,
      userId: payload.userId,
      engagementId: payload.engagementId as Id<"engagements">,
    });

    // 2) Sandbox E2B dedicado (NÃO o do engajamento). Escreve o renderer + model.
    const sbx = await Sandbox.create({
      apiKey: process.env.E2B_API_KEY,
      ...(process.env.E2B_TEMPLATE
        ? { template: process.env.E2B_TEMPLATE }
        : {}),
      timeoutMs: 10 * 60 * 1000,
    });
    try {
      const base = "/home/user/report-renderer";

      // 2a) Baixa as evidências em imagem do S3 para dentro do sandbox e mapeia
      //     s3Key → caminho local (relativo ao renderer). Bounded p/ limitar o job.
      const MAX_IMAGES = 40;
      const imagePathByS3 = new Map<string, string>();
      let imgIdx = 0;
      for (const f of input.findings) {
        for (const e of f.evidence) {
          if (imgIdx >= MAX_IMAGES) break;
          const key = e.s3Key;
          const mt = e.mediaType;
          if (!key || !mt || !mt.startsWith("image/") || imagePathByS3.has(key))
            continue;
          try {
            const obj = await s3.send(
              new GetObjectCommand({ Bucket: bucket, Key: key }),
            );
            const bytes = await obj.Body?.transformToByteArray();
            if (!bytes) continue;
            const ext = mt.split("/")[1]?.split("+")[0] || "png";
            const rel = `evidence/img_${imgIdx}.${ext}`;
            const ab = bytes.buffer.slice(
              bytes.byteOffset,
              bytes.byteOffset + bytes.byteLength,
            ) as ArrayBuffer;
            await sbx.files.write(`${base}/${rel}`, ab);
            imagePathByS3.set(key, rel);
            imgIdx++;
          } catch (imgErr) {
            console.error(
              "report: falha ao baixar evidência de imagem",
              imgErr,
            );
          }
        }
      }

      // 2b) Monta o ReportModel em TS, já com imagePath resolvido.
      const reportInput: ReportInput = {
        client: input.client,
        engagement: input.engagement,
        author: payload.generatedBy,
        generatedAt: Date.now(),
        version: payload.version,
        findings: input.findings.map((f) => ({
          ref: f.ref,
          title: f.title,
          severity: f.severity,
          affectedAsset: f.affectedAsset,
          weaknessClass: f.weaknessClass,
          cwe: f.cwe ?? undefined,
          cvssVector: f.cvssVector ?? undefined,
          cvssScore: f.cvssScore ?? undefined,
          description: f.description ?? undefined,
          impact: f.impact ?? undefined,
          remediation: f.remediation ?? undefined,
          narrative: f.narrative ?? undefined,
          reproductionSteps: f.reproductionSteps ?? [],
          evidence: f.evidence.map((e) => ({
            sourceType: e.sourceType,
            label: e.label ?? undefined,
            snippet: e.snippet ?? undefined,
            stepIndex: e.stepIndex ?? undefined,
            toolName: e.toolName ?? undefined,
            command: e.command ?? undefined,
            resultSummary: e.resultSummary ?? undefined,
            imagePath: e.s3Key ? imagePathByS3.get(e.s3Key) : undefined,
          })),
        })),
      };
      const model = buildReportModel(payload.audience, reportInput);

      for (const [fn, src] of Object.entries(RENDERER_SOURCES)) {
        await sbx.files.write(`${base}/${fn}`, src);
      }
      await sbx.files.write(`${base}/model.json`, JSON.stringify(model));

      for (const format of payload.formats) {
        await client.mutation(api.reports.markReportRenderingForBackend, {
          serviceKey,
          reportGroupId: payload.reportGroupId,
          format,
        });
        metadata.set(`format.${format}`, "rendering");
        try {
          const outName = `out.${EXT[format]}`;
          const res = await sbx.commands.run(
            `cd ${base} && python3 render_report.py model.json ${format} ${outName}`,
            { timeoutMs: 5 * 60 * 1000 },
          );
          if (res.exitCode !== 0) {
            throw new Error(
              `renderer exit ${res.exitCode}: ${res.stderr?.slice(0, 300)}`,
            );
          }
          const bytes = await sbx.files.read(`${base}/${outName}`, {
            format: "bytes",
          });
          const buf = Buffer.from(bytes);
          const s3Key = `engagements/${payload.engagementId}/reports/${payload.audience}/v${payload.version}/${format}.${EXT[format]}`;
          await s3.send(
            new PutObjectCommand({
              Bucket: bucket,
              Key: s3Key,
              Body: buf,
              ContentType: MIME[format],
            }),
          );
          await client.mutation(api.reports.markReportReadyForBackend, {
            serviceKey,
            reportGroupId: payload.reportGroupId,
            format,
            s3Key,
            sizeBytes: buf.length,
            checksum: createHash("sha256").update(buf).digest("hex"),
          });
          metadata.set(`format.${format}`, "ready");
        } catch (err) {
          await client.mutation(api.reports.markReportFailedForBackend, {
            serviceKey,
            reportGroupId: payload.reportGroupId,
            format,
            error: err instanceof Error ? err.message : String(err),
          });
          metadata.set(`format.${format}`, "failed");
        }
      }
    } finally {
      await sbx.kill();
    }
    return { reportGroupId: payload.reportGroupId };
  },
});
