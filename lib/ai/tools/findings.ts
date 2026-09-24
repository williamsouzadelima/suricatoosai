import { tool } from "ai";
import type { ToolContext } from "@/types";
import { captureFinding } from "@/lib/db/findings";
import { captureFindingTool, type CaptureFindingToolInput } from "./schemas";

/**
 * Registra um achado de segurança estruturado (em RASCUNHO) no engajamento
 * atual, com evidência, para curadoria humana e geração de relatório. O agente
 * nunca aprova/publica — só captura. Espelha lib/ai/tools/notes.ts.
 */
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
          evidence: evidence?.map((e) => ({
            source_type: e.source_type,
            label: e.label,
            snippet: e.snippet,
            tool_call_id: e.tool_call_id,
            message_id: e.message_id,
          })),
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
