import "server-only";

import { getConvexClient } from "./convex-client";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { createFindingFingerprint } from "@/lib/ai/subagents/fingerprint";

/**
 * Bridge Node da captura de achados (ferramenta capture_finding do agente).
 *
 * Espelha lib/db/actions.ts::createNote: lê o serviceKey do ambiente e chama as
 * mutations Convex *ForBackend. O fingerprint de dedup é calculado AQUI (Node,
 * server-only) porque o runtime V8 do Convex não tem node:crypto.
 */

const serviceKey = process.env.CONVEX_SERVICE_ROLE_KEY!;

export type FindingSeverity = "info" | "low" | "medium" | "high" | "critical";

export type CapturedEvidenceItem = {
  source_type: "tool_output" | "command" | "file" | "http" | "note" | "manual";
  label?: string;
  snippet?: string;
  tool_call_id?: string;
  message_id?: string;
  /** Evidência em arquivo (imagem etc.), resolvida no tool após upload. */
  file_id?: Id<"files">;
  s3_key?: string;
  media_type?: string;
  sandbox_path?: string;
};

export type CaptureFindingParams = {
  userId: string;
  chatId: string;
  title: string;
  affectedAsset: string;
  weaknessClass: string;
  severity: FindingSeverity;
  description?: string;
  impact?: string;
  remediation?: string;
  reproductionSteps?: string[];
  cwe?: string;
  cvssVector?: string;
  cvssScore?: number;
  confidence?: "low" | "medium" | "high";
  origin?: "agent" | "subagent" | "analyst";
  sourceMessageId?: string;
  sourceToolCallId?: string;
  sourceSubagentId?: string;
  evidence?: CapturedEvidenceItem[];
};

export type CaptureFindingResult = {
  success: boolean;
  merged?: boolean;
  finding_id?: string;
  error?: string;
};

export async function captureFinding(
  params: CaptureFindingParams,
): Promise<CaptureFindingResult> {
  const client = getConvexClient();

  // 1) Resolve (ou provisiona) o engajamento do chat — a tenancy é derivada
  //    dele no lado do Convex (ownership + client_id/org).
  const { engagementId } = await client.mutation(
    api.engagements.resolveEngagementForChatBackend,
    { serviceKey, userId: params.userId, chatId: params.chatId },
  );

  // 2) Fingerprint estável (Node) para dedup por engajamento.
  const dedupFingerprint = createFindingFingerprint({
    title: params.title,
    affectedAsset: params.affectedAsset,
    weaknessClass: params.weaknessClass,
  });

  // 3) Grava o achado (sempre em draft; curadoria/aprovação é identity-only).
  return await client.mutation(api.findings.captureFindingForBackend, {
    serviceKey,
    userId: params.userId,
    engagementId,
    dedupFingerprint,
    origin: params.origin ?? "agent",
    title: params.title,
    affectedAsset: params.affectedAsset,
    weaknessClass: params.weaknessClass,
    severity: params.severity,
    description: params.description,
    impact: params.impact,
    remediation: params.remediation,
    reproductionSteps: params.reproductionSteps,
    cwe: params.cwe,
    cvssVector: params.cvssVector,
    cvssScore: params.cvssScore,
    confidence: params.confidence,
    sourceChatId: params.chatId,
    sourceMessageId: params.sourceMessageId,
    sourceToolCallId: params.sourceToolCallId,
    sourceSubagentId: params.sourceSubagentId,
    evidence: params.evidence,
  });
}
