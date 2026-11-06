import "server-only";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { createFindingFingerprint } from "@/lib/ai/subagents/fingerprint";
import { getConvexClient } from "@/lib/db/convex-client";

import type { MappedCaptureArgs } from "./map-finding";

/**
 * Grava um achado do motor pelo MESMO seam da captura do agente
 * (captureFindingForBackend, sempre draft, tenancy derivada do engajamento).
 * Diferença: o engajamento vem direto (não de um chat), então computamos o
 * dedupFingerprint aqui (Node) — igual ao lib/db/findings.ts::captureFinding.
 *
 * Idempotência: o fingerprint (title+affectedAsset+weaknessClass) faz o re-push
 * do mesmo achado MESCLAR no draft existente em vez de duplicar.
 */

const serviceKey = process.env.CONVEX_SERVICE_ROLE_KEY!;

export type EngineCaptureResult = {
  success: boolean;
  merged?: boolean;
  finding_id?: string;
  error?: string;
};

export async function captureEngineFinding(
  args: MappedCaptureArgs,
): Promise<EngineCaptureResult> {
  const client = getConvexClient();

  const dedupFingerprint = createFindingFingerprint({
    title: args.title,
    affectedAsset: args.affectedAsset,
    weaknessClass: args.weaknessClass,
  });

  return await client.mutation(api.findings.captureFindingForBackend, {
    serviceKey,
    userId: args.userId,
    engagementId: args.engagementId as Id<"engagements">,
    dedupFingerprint,
    origin: args.origin,
    title: args.title,
    affectedAsset: args.affectedAsset,
    weaknessClass: args.weaknessClass,
    severity: args.severity,
    description: args.description,
    impact: args.impact,
    remediation: args.remediation,
    narrative: args.narrative,
    reproductionSteps: args.reproductionSteps,
    cwe: args.cwe,
    cvssVector: args.cvssVector,
    cvssScore: args.cvssScore,
    confidence: args.confidence,
    evidence: args.evidence,
  });
}
