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
import { generateEngagementNarrative } from "./generate-narrative";
import { cvssBaseScore } from "@/lib/reports/cvss";
import type { ReportInput } from "@/lib/reports/report-model";
import type { Id } from "@/convex/_generated/dataModel";
import { RENDERER_SOURCES } from "../packages/report-renderer/sources";
import { RENDERER_FONTS } from "../packages/report-renderer/fonts";

export const REPORT_GENERATION_TASK_ID = "generate-engagement-report";

const EXT: Record<string, string> = {
  docx: "docx",
  pptx: "pptx",
  pdf: "pdf",
  json: "json",
};
const MIME: Record<string, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  pdf: "application/pdf",
  json: "application/json",
};

const payloadSchema = z.object({
  engagementId: z.string().min(1),
  userId: z.string().min(1),
  audience: z.enum(["technical", "executive", "commercial", "action_plan"]),
  formats: z.array(z.enum(["docx", "pptx", "pdf", "json"])).min(1),
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

const AUDIENCE_LABEL: Record<string, string> = {
  technical: "Técnico",
  executive: "Executivo",
  commercial: "Comercial",
  action_plan: "Plano de Ação",
};

/**
 * Notifica o solicitante por e-mail quando o grupo de relatórios termina.
 * Best-effort: sem RESEND_API_KEY, sem e-mail válido, ou falha de rede → apenas
 * loga e segue. generatedBy já vem como e-mail do analista (a rota usa
 * staff.user.email); baixar sempre pela rota-proxy autenticada (nunca anexa o
 * binário no e-mail).
 */
async function notifyReportDone(
  payload: {
    generatedBy: string;
    audience: string;
    version: number;
  },
  ready: string[],
  failed: string[],
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = payload.generatedBy;
  if (!apiKey || !to || !to.includes("@")) return;
  if (ready.length === 0 && failed.length === 0) return;

  const from =
    process.env.MARKETING_EMAIL_FROM ?? "Suricatoos <noreply@suricatoos.com>";
  const appUrl = (
    process.env.NEXT_PUBLIC_APP_URL ?? "https://ai.suricatoos.com"
  ).replace(/\/$/, "");
  const link = `${appUrl}/engagements`;
  const aud = AUDIENCE_LABEL[payload.audience] ?? payload.audience;
  const ok = ready.length > 0;
  const subject = ok
    ? `Relatório ${aud} v${payload.version} pronto`
    : `Falha ao gerar relatório ${aud} v${payload.version}`;
  const line = ok
    ? `Seu relatório <strong>${aud} v${payload.version}</strong> está pronto (${ready
        .map((f) => f.toUpperCase())
        .join(", ")}).${
        failed.length
          ? ` Falharam: ${failed.map((f) => f.toUpperCase()).join(", ")}.`
          : ""
      }`
    : `Não foi possível gerar o relatório <strong>${aud} v${payload.version}</strong> (${failed
        .map((f) => f.toUpperCase())
        .join(", ")}).`;
  const html = `<div style="font-family:system-ui,sans-serif;font-size:14px;color:#0e1b2e;line-height:1.6">
  <p>${line}</p>
  <p><a href="${link}" style="display:inline-block;background:#2456e6;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Abrir em Engajamentos</a></p>
  <p style="color:#64748b;font-size:12px">O download é autenticado — abra a plataforma para baixar.</p>
</div>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to, subject, html }),
  });
  if (!res.ok) {
    console.error(`notify: Resend HTTP ${res.status}`);
  }
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
      // Teto POR ACHADO (não global) + prioridade a crítico/alto, para que
      // achados finais de engajamentos grandes não fiquem sem print (WS3-D).
      const MAX_IMAGES_TOTAL = 150;
      const MAX_IMAGES_PER_FINDING = 8;
      const imagePathByS3 = new Map<string, string>();
      // s3Keys de evidência em imagem cujo download FALHOU (objeto ausente/
      // expirado) — distingue "capturada mas indisponível" de "nunca capturada".
      const failedS3Keys = new Set<string>();
      let imgIdx = 0;
      const sevRank: Record<string, number> = {
        critical: 0,
        high: 1,
        medium: 2,
        low: 3,
        info: 4,
      };
      const orderedFindings = [...input.findings].sort(
        (a, b) => (sevRank[a.severity] ?? 9) - (sevRank[b.severity] ?? 9),
      );
      for (const f of orderedFindings) {
        let perFinding = 0;
        for (const e of f.evidence) {
          if (imgIdx >= MAX_IMAGES_TOTAL) break;
          if (perFinding >= MAX_IMAGES_PER_FINDING) break;
          const key = e.s3Key;
          const mt = e.mediaType;
          if (!key || !mt || !mt.startsWith("image/")) continue;
          if (imagePathByS3.has(key)) {
            perFinding++;
            continue;
          }
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
            perFinding++;
          } catch (imgErr) {
            if (key) failedS3Keys.add(key);
            console.error(
              "report: falha ao baixar evidência de imagem",
              imgErr,
            );
          }
        }
      }

      // 2a-bis) Logo da marca (se houver) → caminho local p/ a capa.
      let brandLogoPath: string | undefined;
      if (input.brandLogo?.s3Key) {
        try {
          const obj = await s3.send(
            new GetObjectCommand({
              Bucket: bucket,
              Key: input.brandLogo.s3Key,
            }),
          );
          const bytes = await obj.Body?.transformToByteArray();
          if (bytes) {
            const mt = input.brandLogo.mediaType || "image/png";
            const ext = mt.split("/")[1]?.split("+")[0] || "png";
            const rel = `brand/logo.${ext}`;
            const ab = bytes.buffer.slice(
              bytes.byteOffset,
              bytes.byteOffset + bytes.byteLength,
            ) as ArrayBuffer;
            await sbx.files.write(`${base}/${rel}`, ab);
            brandLogoPath = rel;
          }
        } catch (logoErr) {
          console.error("report: falha ao baixar logo da marca", logoErr);
        }
      }

      // 2a-ter) Arte de capa da marca (se houver) → caminho local full-bleed.
      let brandCoverPath: string | undefined;
      if (input.brandCover?.s3Key) {
        try {
          const obj = await s3.send(
            new GetObjectCommand({
              Bucket: bucket,
              Key: input.brandCover.s3Key,
            }),
          );
          const bytes = await obj.Body?.transformToByteArray();
          if (bytes) {
            const mt = input.brandCover.mediaType || "image/png";
            const ext = mt.split("/")[1]?.split("+")[0] || "png";
            const rel = `brand/cover.${ext}`;
            const ab = bytes.buffer.slice(
              bytes.byteOffset,
              bytes.byteOffset + bytes.byteLength,
            ) as ArrayBuffer;
            await sbx.files.write(`${base}/${rel}`, ab);
            brandCoverPath = rel;
          }
        } catch (coverErr) {
          console.error(
            "report: falha ao baixar arte de capa da marca",
            coverErr,
          );
        }
      }

      // 2b) Monta o ReportModel em TS, já com imagePath resolvido.
      const reportInput: ReportInput = {
        client: input.client,
        engagement: input.engagement,
        author: payload.generatedBy,
        generatedAt: Date.now(),
        version: payload.version,
        brand:
          input.brand || brandLogoPath || brandCoverPath
            ? {
                ...(input.brand ?? {}),
                ...(brandLogoPath ? { logoPath: brandLogoPath } : {}),
                ...(brandCoverPath ? { coverImagePath: brandCoverPath } : {}),
              }
            : undefined,
        findings: input.findings.map((f) => ({
          ref: f.ref,
          title: f.title,
          severity: f.severity,
          affectedAsset: f.affectedAsset,
          weaknessClass: f.weaknessClass,
          cwe: f.cwe ?? undefined,
          cvssVector: f.cvssVector ?? undefined,
          // Deriva o score do vetor quando o achado tem vetor mas nao score
          // (extracao grava vetor, nao score) -> enche a coluna/media CVSS.
          cvssScore: f.cvssScore ?? cvssBaseScore(f.cvssVector) ?? undefined,
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
            imageUnavailable: !!(e.s3Key && failedS3Keys.has(e.s3Key)),
          })),
        })),
      };
      // 2b.1) Narrativa "Anatomia da Invasão" (IA) — SÓ técnico. Defensivo:
      // qualquer falha → segue sem narrativa (o relatório cai no formato plano).
      if (payload.audience === "technical") {
        try {
          metadata.set("phase", "narrative");
          const narrative = await generateEngagementNarrative({
            clientName: reportInput.client.name,
            engagementName: reportInput.engagement.name,
            findings: reportInput.findings,
          });
          if (narrative) reportInput.engagementNarrative = narrative;
        } catch (e) {
          console.error("narrative: passo falhou — seguindo sem narrativa", e);
        }
      }
      const model = buildReportModel(payload.audience, reportInput);

      for (const [fn, src] of Object.entries(RENDERER_SOURCES)) {
        await sbx.files.write(`${base}/${fn}`, src);
      }
      // Fontes IBM Plex (OFL) p/ o renderer PDF embutir os glifos — escritas em
      // ${base}/fonts/ (mesmo path relativo que theme.font_path resolve via
      // __file__). base64 -> ArrayBuffer (igual às imagens); e2b cria o dir.
      for (const [fn, b64] of Object.entries(RENDERER_FONTS)) {
        const buf = Buffer.from(b64, "base64");
        const ab = buf.buffer.slice(
          buf.byteOffset,
          buf.byteOffset + buf.byteLength,
        ) as ArrayBuffer;
        await sbx.files.write(`${base}/fonts/${fn}`, ab);
      }
      // Inclui `findings` no topo do model.json: o export `json` o reemite
      // (meta + kpis + charts + sections + findings); docx/pptx/pdf ignoram
      // chaves extras. Nada truncado.
      await sbx.files.write(
        `${base}/model.json`,
        JSON.stringify({ ...model, findings: reportInput.findings }),
      );

      const readyFormats: string[] = [];
      const failedFormats: string[] = [];
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
          // Chave inclui o reportGroupId (único por requisição) p/ NUNCA
          // sobrescrever o objeto de uma geração anterior que tenha reusado o
          // mesmo número de versão — a versão é max+1 sobre linhas VIVAS e se
          // repete após o botão "Remover" apagar grupos. A linha do relatório
          // guarda esta chave (markReportReadyForBackend), e todos os downloads
          // leem o s3_key guardado (nunca reconstroem), então mudar o formato é
          // transparente p/ o app.
          const s3Key = `engagements/${payload.engagementId}/reports/${payload.audience}/v${payload.version}-${payload.reportGroupId}/${format}.${EXT[format]}`;
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
          readyFormats.push(format);
        } catch (err) {
          // E2B lança CommandExitError (implements CommandResult) em exit≠0 —
          // o `.stderr` carrega o traceback REAL do renderer Python. Sem isso o
          // erro fica só "exit status 1" (a message do CommandExitError) e o
          // diagnóstico se perde. Anexa o stderr quando presente.
          const baseMsg = err instanceof Error ? err.message : String(err);
          const stderr =
            err && typeof err === "object" && "stderr" in err
              ? String((err as { stderr?: unknown }).stderr ?? "").trim()
              : "";
          const error = stderr
            ? `${baseMsg} — ${stderr.slice(0, 600)}`
            : baseMsg;
          await client.mutation(api.reports.markReportFailedForBackend, {
            serviceKey,
            reportGroupId: payload.reportGroupId,
            format,
            error,
          });
          metadata.set(`format.${format}`, "failed");
          failedFormats.push(format);
        }
      }

      // Notificação best-effort ao solicitante quando o grupo termina. Nunca
      // falha a task. generatedBy já é o e-mail do analista (route usa
      // staff.user.email); só envia se for um e-mail e houver Resend.
      await notifyReportDone(payload, readyFormats, failedFormats).catch((e) =>
        console.error("notify: falhou (ignorado)", e),
      );
    } finally {
      await sbx.kill();
    }
    return { reportGroupId: payload.reportGroupId };
  },
});
