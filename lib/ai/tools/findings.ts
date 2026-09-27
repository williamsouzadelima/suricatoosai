import { tool } from "ai";
import type { AnySandbox, ToolContext } from "@/types";
import { captureFinding, type CapturedEvidenceItem } from "@/lib/db/findings";
import { uploadSandboxFileToConvex } from "./utils/sandbox-file-uploader";
import { getSandboxWithFallbackGuard } from "./utils/sandbox-fallback";
import { captureFindingTool, type CaptureFindingToolInput } from "./schemas";

/**
 * Registra um achado de segurança estruturado (em RASCUNHO) no engajamento
 * atual, com evidência, para curadoria humana e geração de relatório. O agente
 * nunca aprova/publica — só captura. Espelha lib/ai/tools/notes.ts.
 *
 * Evidência com `file_path` (ex.: screenshot no sandbox) é enviada ao S3/Convex
 * pelo pipeline existente (uploadSandboxFileToConvex) e vira evidência VISUAL,
 * embutida no relatório técnico.
 */

const EXT_MEDIA_TYPE: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
};

function inferMediaType(path: string, explicit?: string): string | undefined {
  if (explicit) return explicit;
  const ext = path.split(/[/\\]/).pop()?.split(".").pop()?.toLowerCase();
  return ext ? EXT_MEDIA_TYPE[ext] : undefined;
}

function baseName(path: string): string {
  return path.split(/[/\\]/).pop() || "evidencia";
}

export const createCaptureFinding = (context: ToolContext) => {
  return tool({
    ...captureFindingTool,
    execute: async ({
      title,
      affected_asset,
      weakness_class,
      severity,
      description,
      impact,
      remediation,
      reproduction_steps,
      cwe,
      cvss_vector,
      confidence,
      evidence,
    }: CaptureFindingToolInput) => {
      try {
        // Resolve o sandbox uma única vez, e só se houver arquivo a subir.
        const needsSandbox = (evidence ?? []).some((e) => e.file_path);
        let sandbox: AnySandbox | null = null;
        if (needsSandbox) {
          try {
            sandbox = (
              await getSandboxWithFallbackGuard({
                sandboxManager: context.sandboxManager,
              })
            ).sandbox;
          } catch (e) {
            console.error("capture_finding: sandbox indisponível:", e);
          }
        }

        const evidenceItems: CapturedEvidenceItem[] = [];
        for (const e of evidence ?? []) {
          const item: CapturedEvidenceItem = {
            source_type: e.source_type,
            label: e.label,
            snippet: e.snippet,
            tool_call_id: e.tool_call_id,
            message_id: e.message_id,
          };
          if (e.file_path) {
            const mediaType = inferMediaType(e.file_path, e.media_type);
            if (!sandbox) {
              // Sem sandbox: registra a evidência como referência textual.
              item.label = `${item.label ?? "Evidência"} (arquivo não anexado: ${baseName(
                e.file_path,
              )})`;
            } else {
              try {
                const uploaded = await uploadSandboxFileToConvex({
                  sandbox,
                  userId: context.userID,
                  fullPath: e.file_path,
                  mediaType,
                  name: baseName(e.file_path),
                });
                item.source_type = "file";
                item.file_id = uploaded.fileId;
                item.s3_key = uploaded.s3Key;
                item.media_type = uploaded.mediaType;
                item.sandbox_path = e.file_path;
                if (!item.label) item.label = uploaded.name;
              } catch (upErr) {
                console.error(
                  "capture_finding: falha ao anexar arquivo:",
                  upErr,
                );
                item.label = `${item.label ?? "Evidência"} (falha ao anexar ${baseName(
                  e.file_path,
                )})`;
              }
            }
          }
          evidenceItems.push(item);
        }

        const result = await captureFinding({
          userId: context.userID,
          chatId: context.chatId,
          title,
          affectedAsset: affected_asset,
          weaknessClass: weakness_class,
          severity,
          description,
          impact,
          remediation,
          reproductionSteps: reproduction_steps,
          cwe,
          cvssVector: cvss_vector,
          confidence,
          origin: "agent",
          sourceMessageId: context.assistantMessageId,
          evidence: evidenceItems,
        });

        if (!result.success) {
          return {
            success: false,
            error: result.error || "Falha ao registrar achado",
          };
        }

        return {
          success: true,
          finding_id: result.finding_id,
          message: result.merged
            ? `Evidência anexada ao achado existente '${title}'.`
            : `Achado '${title}' registrado em rascunho para curadoria.`,
        };
      } catch (error) {
        console.error("capture_finding tool error:", error);
        return {
          success: false,
          error: `Falha ao registrar achado: ${
            error instanceof Error ? error.message : String(error)
          }`,
        };
      }
    },
  });
};
