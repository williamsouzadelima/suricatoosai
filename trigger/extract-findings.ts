import { schemaTask } from "@trigger.dev/sdk";
import { metadata } from "@trigger.dev/sdk";
import { generateText, Output } from "ai";
import { z } from "zod";
import { myProvider, type ModelName } from "@/lib/ai/providers";
import { getConvexClient } from "@/lib/db/convex-client";
import { api } from "@/convex/_generated/api";
import { captureFinding, type CapturedEvidenceItem } from "@/lib/db/findings";

/**
 * Extração RETROATIVA de achados de uma task (chat) já concluída.
 *
 * Lê a transcrição (mensagens + saídas de ferramenta), passa por um modelo que
 * emite achados estruturados e grava cada um em RASCUNHO via o bridge
 * captureFinding (mesmo caminho do agente ao vivo → dedup por engajamento +
 * fingerprint aplica). Nada é aprovado/publicado — vai para curadoria.
 *
 * O chat já deve estar ANEXADO ao engajamento (a rota anexa antes de disparar);
 * o bridge resolve o engajamento a partir do chat.
 */

export const EXTRACT_FINDINGS_TASK_ID = "extract-findings-from-chat";

// Chave REGISTRADA no myProvider (customProvider) — não aceita slug cru.
// "model-grok-4.6" é a mesma usada pelo user-research (transcrição → estruturado).
const EXTRACTION_MODEL_KEY = "model-grok-4.6" satisfies ModelName;

const MAX_FINDINGS = 40;
const PROMPT_CHAR_BUDGET = 120_000;

const severityEnum = z.enum(["info", "low", "medium", "high", "critical"]);

const extractedFindingSchema = z.object({
  title: z.string().describe("Título conciso do achado."),
  affected_asset: z
    .string()
    .describe("Ativo afetado (host, URL, endpoint, parâmetro)."),
  weakness_class: z
    .string()
    .describe("Classe da fraqueza (ex.: SQL Injection, IDOR, XSS)."),
  severity: severityEnum,
  description: z.string().optional(),
  impact: z.string().optional(),
  remediation: z.string().optional(),
  reproduction_steps: z.array(z.string()).optional(),
  cwe: z.string().optional(),
  cvss_vector: z.string().optional(),
  confidence: z.enum(["low", "medium", "high"]).optional(),
  evidence: z
    .array(
      z.object({
        label: z.string().optional(),
        snippet: z
          .string()
          .optional()
          .describe("Trecho VERBATIM da transcrição que sustenta o achado."),
        file_name: z
          .string()
          .optional()
          .describe(
            "Nome EXATO de um arquivo/print da lista 'Arquivos desta task', quando a evidência for um arquivo salvo (ex.: screenshot).",
          ),
      }),
    )
    .optional(),
});

const extractionSchema = z.object({
  findings: z.array(extractedFindingSchema),
});

const payloadSchema = z.object({
  chatId: z.string().min(1),
  userId: z.string().min(1),
});

function buildPrompt(
  title: string,
  messages: { role: string; text: string }[],
  files: { name: string; mediaType: string }[],
): string {
  let budget = PROMPT_CHAR_BUDGET;
  const lines: string[] = [];
  for (const m of messages) {
    const line = `${m.role.toUpperCase()}: ${m.text}`;
    if (line.length > budget) {
      lines.push(line.slice(0, budget));
      break;
    }
    lines.push(line);
    budget -= line.length + 1;
  }
  const fileList = files.length
    ? files
        .slice(0, 40)
        .map((f) => `- ${f.name} (${f.mediaType})`)
        .join("\n")
    : "(nenhum)";
  return `Você é um pentester sênior revisando a transcrição de uma task de pentest JÁ CONCLUÍDA (título: "${title}"). Extraia os ACHADOS de segurança distintos que tenham SUPORTE explícito na transcrição.

Regras:
- NÃO invente. Só reporte o que a transcrição sustenta; cite o trecho como evidência (verbatim) em evidence[].snippet.
- Se um achado for sustentado por um print/arquivo salvo, referencie o NOME EXATO do arquivo (da lista abaixo) em evidence[].file_name.
- Um achado por vulnerabilidade distinta; não combine itens não relacionados.
- Preencha severity sempre; description/impact/remediation/CWE/CVSS quando a transcrição permitir.
- Se nada de segurança relevante foi encontrado, retorne uma lista vazia.

=== ARQUIVOS DESTA TASK ===
${fileList}

=== TRANSCRIÇÃO ===
${lines.join("\n")}
=== FIM ===`;
}

export const extractFindingsFromChat = schemaTask({
  id: EXTRACT_FINDINGS_TASK_ID,
  schema: payloadSchema,
  maxDuration: 10 * 60,
  machine: { preset: "small-1x" },
  run: async (payload) => {
    const serviceKey = process.env.CONVEX_SERVICE_ROLE_KEY;
    if (!serviceKey) throw new Error("CONVEX_SERVICE_ROLE_KEY ausente");
    const convex = getConvexClient();

    metadata.set("phase", "loading");
    const transcript = await convex.query(
      api.engagementCapture.getChatTranscriptForBackend,
      { serviceKey, userId: payload.userId, chatId: payload.chatId },
    );
    if (!transcript.messages.length) {
      metadata.set("phase", "empty");
      return { captured: 0, merged: 0, total: 0, reason: "sem transcrição" };
    }

    metadata.set("phase", "extracting");
    const result = await generateText({
      model: myProvider.languageModel(EXTRACTION_MODEL_KEY),
      output: Output.object({ schema: extractionSchema }),
      temperature: 0,
      maxOutputTokens: 8_000,
      maxRetries: 1,
      prompt: buildPrompt(
        transcript.title,
        transcript.messages,
        transcript.files,
      ),
    });
    const findings = (result.output?.findings ?? []).slice(0, MAX_FINDINGS);
    metadata.set("extracted", findings.length);

    // Nome do arquivo → metadados, para anexar prints/saídas como evidência.
    const fileByName = new Map<string, (typeof transcript.files)[number]>();
    for (const fl of transcript.files) fileByName.set(fl.name, fl);

    metadata.set("phase", "saving");
    let captured = 0;
    let merged = 0;
    for (const f of findings) {
      try {
        const res = await captureFinding({
          userId: payload.userId,
          chatId: payload.chatId,
          title: f.title,
          affectedAsset: f.affected_asset,
          weaknessClass: f.weakness_class,
          severity: f.severity,
          description: f.description,
          impact: f.impact,
          remediation: f.remediation,
          reproductionSteps: f.reproduction_steps,
          cwe: f.cwe,
          cvssVector: f.cvss_vector,
          confidence: f.confidence,
          origin: "agent",
          evidence: (f.evidence ?? []).map((e): CapturedEvidenceItem => {
            const fl = e.file_name ? fileByName.get(e.file_name) : undefined;
            if (fl) {
              // Evidência em ARQUIVO (print/saída salva na task).
              return {
                source_type: "file",
                label: e.label ?? fl.name,
                snippet: e.snippet,
                file_id: fl.fileId,
                s3_key: fl.s3Key ?? undefined,
                media_type: fl.mediaType,
              };
            }
            return {
              source_type: "tool_output",
              label: e.label,
              snippet: e.snippet,
            };
          }),
        });
        if (res.success) {
          captured += 1;
          if (res.merged) merged += 1;
        }
      } catch (err) {
        console.error("extract-findings: falha ao gravar achado", err);
      }
    }

    metadata.set("phase", "done");
    return { captured, merged, total: findings.length };
  },
});
