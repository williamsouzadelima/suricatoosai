import { schemaTask } from "@trigger.dev/sdk";
import { metadata } from "@trigger.dev/sdk";
import { ConvexHttpClient } from "convex/browser";
import { Sandbox } from "@e2b/code-interpreter";
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { generateText, Output } from "ai";
import { z } from "zod";
import { myProvider, type ModelName } from "@/lib/ai/providers";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { createFindingFingerprint } from "@/lib/ai/subagents/fingerprint";

/**
 * Ingestão de um BUNDLE de evidências (tar.gz/zip) de uma task de pentest para
 * dentro de um engajamento. Extrai o corpus real de artefatos (scripts de
 * exploit, saídas, screenshots, JSON/HTML, .md de relatório), usa o(s) .md como
 * FONTE dos achados e a IA para mapear cada artefato na cadeia de evidência
 * (comando=script, resultado=saída, prova=screenshot). Grava achados em RASCUNHO
 * para curadoria — nada é aprovado/publicado.
 */

export const INGEST_BUNDLE_TASK_ID = "ingest-evidence-bundle";

const MODEL_KEY = "model-grok-4.6" satisfies ModelName;
const MAX_FINDINGS = 60;
const MAX_CHAIN = 30;
const MAX_IMAGES = 80;
const MD_BUDGET = 160_000;
const MANIFEST_BUDGET = 40_000;
const TEXT_ARTIFACT_CLAMP = 6000;
const CMD_CLAMP = 800;

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp"]);
const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
};

const severityEnum = z.enum(["info", "low", "medium", "high", "critical"]);

const stepSchema = z.object({
  step: z.number().int().optional(),
  tool_name: z.string().optional().describe("Ferramenta (curl, sqlmap, etc.)."),
  command: z
    .string()
    .optional()
    .describe("Comando/requisição executado (verbatim), se conhecido."),
  output_snippet: z
    .string()
    .optional()
    .describe("Trecho da saída que comprova, se não vier de um arquivo."),
  significance: z.string().optional().describe("O que este passo PROVA."),
  artifact_name: z
    .string()
    .optional()
    .describe(
      "Nome EXATO de um arquivo do bundle (script, saída .txt/.json, ou screenshot .png) que sustenta o passo — da lista de arquivos.",
    ),
});

const findingSchema = z.object({
  title: z.string(),
  affected_asset: z.string(),
  weakness_class: z.string(),
  severity: severityEnum,
  description: z.string().optional(),
  impact: z.string().optional(),
  remediation: z.string().optional(),
  narrative: z.string().optional(),
  reproduction_steps: z.array(z.string()).optional(),
  cwe: z.string().optional(),
  cvss_vector: z.string().optional(),
  confidence: z.enum(["low", "medium", "high"]).optional(),
  evidence_chain: z.array(stepSchema).optional(),
});

const ingestSchema = z.object({ findings: z.array(findingSchema) });

const payloadSchema = z.object({
  engagementId: z.string().min(1),
  userId: z.string().min(1),
  s3Key: z.string().min(1),
  filename: z.string().min(1),
});

function getClient() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
  const serviceKey = process.env.CONVEX_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceKey) throw new Error("Convex env ausente");
  return { client: new ConvexHttpClient(url), serviceKey };
}

function getS3() {
  const region = process.env.AWS_S3_REGION;
  const accessKeyId = process.env.AWS_S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_S3_SECRET_ACCESS_KEY;
  const bucket = process.env.AWS_S3_BUCKET_NAME;
  if (!region || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error("Config S3 ausente");
  }
  const endpoint = process.env.AWS_S3_ENDPOINT?.trim();
  const s3 = new S3Client({
    region,
    credentials: { accessKeyId, secretAccessKey },
    ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
  });
  return { s3, bucket };
}

function ext(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

export const ingestEvidenceBundle = schemaTask({
  id: INGEST_BUNDLE_TASK_ID,
  schema: payloadSchema,
  maxDuration: 20 * 60,
  machine: { preset: "small-1x" },
  run: async (payload) => {
    const { client, serviceKey } = getClient();
    const { s3, bucket } = getS3();
    const engagementId = payload.engagementId as Id<"engagements">;

    metadata.set("phase", "downloading");
    const obj = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: payload.s3Key }),
    );
    const bytes = await obj.Body?.transformToByteArray();
    if (!bytes) throw new Error("Bundle vazio no S3");

    const sbx = await Sandbox.create({
      apiKey: process.env.E2B_API_KEY,
      ...(process.env.E2B_TEMPLATE
        ? { template: process.env.E2B_TEMPLATE }
        : {}),
      timeoutMs: 15 * 60 * 1000,
    });
    try {
      metadata.set("phase", "extracting");
      const isZip = payload.filename.toLowerCase().endsWith(".zip");
      const bundlePath = `/home/user/bundle.${isZip ? "zip" : "tgz"}`;
      const ab = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
      await sbx.files.write(bundlePath, ab);
      const extractCmd = isZip
        ? `rm -rf /home/user/b && mkdir -p /home/user/b && cd /home/user/b && unzip -o ${bundlePath} >/dev/null 2>&1; echo done`
        : `rm -rf /home/user/b && mkdir -p /home/user/b && tar xzf ${bundlePath} -C /home/user/b 2>/dev/null; echo done`;
      await sbx.commands.run(extractCmd, { timeoutMs: 3 * 60 * 1000 });

      // Manifesto (nome + tamanho, relativo à raiz do bundle).
      const listed = await sbx.commands.run(
        `cd /home/user/b && find . -type f -printf '%P\\t%s\\n' 2>/dev/null | sort`,
        { timeoutMs: 60 * 1000 },
      );
      const files = (listed.stdout || "")
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => {
          const [name, size] = l.split("\t");
          return { name, size: Number(size) || 0 };
        })
        .filter((f) => f.name && !f.name.startsWith("."));
      const fileNames = new Set(files.map((f) => f.name));
      // Fallback por basename: os prints costumam viver em subpastas
      // (screenshots/, webapp_evidence/); o modelo às vezes referencia só o
      // nome do arquivo. Mapeia basename → caminho completo (1º vence).
      const byBasename = new Map<string, string>();
      for (const f of files) {
        const base = f.name.split("/").pop();
        if (base && !byBasename.has(base)) byBasename.set(base, f.name);
      }
      const resolveArtifact = (art: string): string | null => {
        if (fileNames.has(art)) return art;
        const base = art.split("/").pop();
        return (base && byBasename.get(base)) || null;
      };
      metadata.set("files", files.length);

      // .md de relatório/achados = FONTE dos achados.
      const mdFiles = files
        .filter((f) => f.name.toLowerCase().endsWith(".md"))
        .sort((a, b) => b.size - a.size);
      let mdCorpus = "";
      for (const f of mdFiles) {
        if (mdCorpus.length >= MD_BUDGET) break;
        try {
          const content = await sbx.files.read(`/home/user/b/${f.name}`);
          mdCorpus += `\n\n===== ${f.name} =====\n${content}`;
        } catch {
          /* ignora arquivo ilegível */
        }
      }
      mdCorpus = mdCorpus.slice(0, MD_BUDGET);

      const manifest = files
        .map((f) => `${f.name} (${f.size}b)`)
        .join("\n")
        .slice(0, MANIFEST_BUDGET);

      metadata.set("phase", "structuring");
      const result = await generateText({
        model: myProvider.languageModel(MODEL_KEY),
        output: Output.object({ schema: ingestSchema }),
        temperature: 0,
        maxOutputTokens: 24_000,
        maxRetries: 1,
        prompt: buildPrompt(payload.filename, mdCorpus, manifest),
      });
      const findings = (result.output?.findings ?? []).slice(0, MAX_FINDINGS);
      metadata.set("extracted", findings.length);

      // 1) Sobe TODOS os screenshots do bundle UMA vez (não depende do LLM).
      metadata.set("phase", "uploading-images");
      const norm = (s: string) =>
        (s || "")
          .toLowerCase()
          .normalize("NFD")
          .replace(/[̀-ͯ]/g, "")
          .replace(/[^a-z0-9]+/g, " ");
      type UpImg = {
        fileId: Id<"files">;
        s3Key: string;
        mediaType: string;
        name: string;
      };
      const uploaded: UpImg[] = [];
      const imgFiles = files
        .filter((f) => IMAGE_EXT.has(ext(f.name)))
        .slice(0, MAX_IMAGES);
      for (const [idx, f] of imgFiles.entries()) {
        try {
          const e = ext(f.name);
          const base = f.name.split("/").pop() ?? f.name;
          const imgBytes = await sbx.files.read(`/home/user/b/${f.name}`, {
            format: "bytes",
          });
          const buf = Buffer.from(imgBytes);
          const key = `users/${payload.userId}/evidence/${Date.now()}-${idx}-${base.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
          await s3.send(
            new PutObjectCommand({
              Bucket: bucket,
              Key: key,
              Body: buf,
              ContentType: MIME[e] ?? "application/octet-stream",
            }),
          );
          const saved = await client.action(
            api.fileActions.saveSandboxGeneratedFile,
            {
              s3Key: key,
              name: base,
              mediaType: MIME[e] ?? "application/octet-stream",
              size: buf.length,
              serviceKey,
              userId: payload.userId,
            },
          );
          uploaded.push({
            fileId: saved.fileId,
            s3Key: key,
            mediaType: MIME[e] ?? "application/octet-stream",
            name: base,
          });
        } catch (imgErr) {
          console.error("ingest: falha ao subir imagem", f.name, imgErr);
        }
      }
      metadata.set("images", uploaded.length);

      // 2) Associa cada screenshot ao achado de melhor correspondência (nome);
      //    sem match → o achado mais severo (garante que o print apareça).
      const sevOrder = ["critical", "high", "medium", "low", "info"];
      const findingKw = findings.map((f) => {
        const toks = new Set<string>();
        for (const src of [f.title, f.weakness_class, f.affected_asset]) {
          for (const t of norm(src).split(" ")) if (t.length >= 4) toks.add(t);
        }
        return toks;
      });
      let severest = 0;
      findings.forEach((f, i) => {
        if (
          sevOrder.indexOf(f.severity) <
          sevOrder.indexOf(findings[severest].severity)
        )
          severest = i;
      });
      const imagesByFinding = new Map<number, UpImg[]>();
      for (const img of uploaded) {
        const base = norm(img.name);
        let best = -1;
        let bestScore = 0;
        findingKw.forEach((kw, i) => {
          let score = 0;
          for (const t of kw) if (base.includes(t)) score += 1;
          if (score > bestScore) {
            bestScore = score;
            best = i;
          }
        });
        const target = best >= 0 ? best : findings.length ? severest : -1;
        if (target >= 0) {
          const arr = imagesByFinding.get(target) ?? [];
          if (arr.length < 8) {
            arr.push(img);
            imagesByFinding.set(target, arr);
          }
        }
      }

      // 3) Grava cada achado: cadeia textual do LLM + evidência visual anexada.
      metadata.set("phase", "saving");
      let captured = 0;
      for (const [fi, f] of findings.entries()) {
        try {
          const evidence: Record<string, unknown>[] = [];
          let step = 0;
          for (const s of (f.evidence_chain ?? []).slice(0, MAX_CHAIN)) {
            const item: Record<string, unknown> = {
              source_type: s.command ? "command" : "tool_output",
              step_index: ++step,
              tool_name: s.tool_name,
              command: s.command,
              snippet: s.output_snippet,
              result_summary: s.significance,
              label: s.tool_name,
            };
            const rel = s.artifact_name
              ? resolveArtifact(s.artifact_name)
              : null;
            // Imagens sao anexadas deterministicamente (passo 2); aqui so texto.
            if (rel && !IMAGE_EXT.has(ext(rel))) {
              try {
                const content = await sbx.files.read(`/home/user/b/${rel}`);
                const e = ext(rel);
                if ((e === "py" || e === "js" || e === "sh") && !s.command) {
                  item.command = content.slice(0, CMD_CLAMP);
                  item.source_type = "command";
                }
                if (!s.output_snippet) {
                  item.snippet = content.slice(0, TEXT_ARTIFACT_CLAMP);
                }
                item.label = s.tool_name ?? rel.split("/").pop() ?? rel;
              } catch {
                /* ignora */
              }
            }
            evidence.push(item);
          }
          for (const img of imagesByFinding.get(fi) ?? []) {
            evidence.push({
              source_type: "file",
              step_index: ++step,
              tool_name: "screenshot",
              label: img.name,
              result_summary: "Evidência visual.",
              file_id: img.fileId,
              s3_key: img.s3Key,
              media_type: img.mediaType,
            });
          }

          const dedupFingerprint = createFindingFingerprint({
            title: f.title,
            affectedAsset: f.affected_asset,
            weaknessClass: f.weakness_class,
          });
          const res = await client.mutation(
            api.findings.captureFindingForBackend,
            {
              serviceKey,
              userId: payload.userId,
              engagementId,
              dedupFingerprint,
              origin: "analyst",
              title: f.title,
              affectedAsset: f.affected_asset,
              weaknessClass: f.weakness_class,
              severity: f.severity,
              description: f.description,
              impact: f.impact,
              remediation: f.remediation,
              narrative: f.narrative,
              reproductionSteps: f.reproduction_steps,
              cwe: f.cwe,
              cvssVector: f.cvss_vector,
              confidence: f.confidence,
              evidence: evidence as never,
            },
          );
          if (res.success) captured += 1;
        } catch (err) {
          console.error("ingest: falha ao gravar achado", err);
        }
      }

      metadata.set("phase", "done");
      return {
        findings: findings.length,
        captured,
        images: uploaded.length,
        files: files.length,
      };
    } finally {
      await sbx.kill();
    }
  },
});

function buildPrompt(
  filename: string,
  mdCorpus: string,
  manifest: string,
): string {
  return `Você é um pentester sênior consolidando o RELATÓRIO a partir de um bundle de evidências de uma task já concluída ("${filename}"). O bundle contém scripts de exploit, saídas, screenshots, JSON/HTML e um ou mais .md de relatório.

REGRA PRINCIPAL: os arquivos .md abaixo são a FONTE DA VERDADE dos achados. Extraia os achados EXATAMENTE como escritos (título, severidade, ativo, impacto, remediação) — não invente nem contradiga.

Para CADA achado, monte a EVIDÊNCIA como uma CADEIA CRONOLÓGICA (evidence_chain), referenciando os ARQUIVOS REAIS do bundle:
- artifact_name: o NOME do arquivo (da lista) que sustenta o passo — o script de exploit (.py), a saída (_output.txt/.json), ou o SCREENSHOT (.png). Prefira SEMPRE apontar um arquivo real. Os screenshots costumam estar em subpastas (screenshots/, screenshots_ev/, webapp_evidence/); pode referenciar pelo nome do arquivo. SEMPRE que houver um screenshot relevante para o achado, inclua-o como passo de PROVA VISUAL.
- tool_name: a ferramenta do passo (curl, sqlmap, nmap, python, etc.).
- command: o comando/requisição, se souber pela transcrição do .md (senão, deixe — será extraído do script).
- significance: o que o passo PROVA.
- narrative: escreva o storytelling do achado (recon → exploração → prova).
Encadeie os passos em ordem (recon → identificação → exploração → prova). Use os screenshots como prova visual no passo adequado.

=== RELATÓRIOS (.md) — FONTE DOS ACHADOS ===
${mdCorpus || "(nenhum .md encontrado — reconstrua a partir dos artefatos)"}

=== ARQUIVOS DO BUNDLE (referencie por nome exato) ===
${manifest}
=== FIM ===`;
}
