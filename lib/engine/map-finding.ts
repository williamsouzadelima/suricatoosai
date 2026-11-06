/**
 * Mapeamento PURO: payload de ingestão do motor → args de captureFindingForBackend
 * (menos serviceKey/dedupFingerprint, que o módulo server-only resolve).
 *
 * Aplica os cuidados verificados na fonte de convex/findings.ts:
 *  - evidência de imagem SEMPRE source_type:"file" + file_id + s3_key + media_type
 *    image/* (file_id é o que sobrevive ao purge de 24h; media_type image/* é o
 *    que a galeria/relatório tratam como imagem);
 *  - LABEL ÚNICO por item: o merge dedupa evidência por
 *    source_type+tool_call_id+message_id+label e, sem tool_call_id/message_id,
 *    dois itens de mesmo source_type+label → o 2º é DESCARTADO em silêncio.
 *    Uniquificamos os labels de todos os itens para nunca perder um print.
 */

import type { CapturedEvidenceItem, FindingSeverity } from "@/lib/db/findings";
import type {
  EngineFindingIngest,
  ResolvedImageUpload,
} from "./types";

export type MappedCaptureArgs = {
  engagementId: string;
  userId: string;
  origin: "agent";
  title: string;
  affectedAsset: string;
  weaknessClass: string;
  severity: FindingSeverity;
  description?: string;
  impact?: string;
  remediation?: string;
  narrative?: string;
  reproductionSteps?: string[];
  cwe?: string;
  cvssVector?: string;
  cvssScore?: number;
  confidence?: "low" | "medium" | "high";
  evidence: CapturedEvidenceItem[];
};

const SEVERITY_SYNONYMS: Record<string, FindingSeverity> = {
  info: "info",
  informational: "info",
  informative: "info",
  none: "info",
  low: "low",
  lo: "low",
  medium: "medium",
  med: "medium",
  moderate: "medium",
  high: "high",
  hi: "high",
  critical: "critical",
  crit: "critical",
};

/** Normaliza a severidade do motor para o enum do platform; lança se desconhecida. */
export function normalizeSeverity(raw: string): FindingSeverity {
  const key = String(raw ?? "").trim().toLowerCase();
  const mapped = SEVERITY_SYNONYMS[key];
  if (!mapped) {
    throw new Error(`engine ingest: severidade desconhecida "${raw}"`);
  }
  return mapped;
}

/**
 * Garante label único em todo o conjunto de evidência. Mantém o primeiro como
 * está; sufixa duplicados com " (2)", " (3)"… (comparação exata, igual ao dedup).
 */
function uniquifyLabels(items: CapturedEvidenceItem[]): CapturedEvidenceItem[] {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const base = item.label ?? "";
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    if (count === 0) return item;
    return { ...item, label: `${base} (${count + 1})` };
  });
}

/**
 * Mapeia um achado do motor para os args do captureFindingForBackend.
 * `uploads` são as imagens já persistidas no S3 (file_id/s3_key resolvidos).
 * Lança se uma imagem declarada não tiver upload correspondente (integridade da
 * evidência gráfica) ou se um upload não for image/*.
 */
export function mapEngineFinding(
  ingest: EngineFindingIngest,
  uploads: ResolvedImageUpload[],
): MappedCaptureArgs {
  const uploadByField = new Map(uploads.map((u) => [u.field, u]));

  const textItems: CapturedEvidenceItem[] = (ingest.textEvidence ?? []).map(
    (t) => ({
      source_type: t.source_type ?? "note",
      label: t.label,
      snippet: t.snippet,
      command: t.command,
      result_summary: t.result_summary,
      step_index: t.step_index,
      tool_name: t.tool_name,
    }),
  );

  const imageItems: CapturedEvidenceItem[] = (ingest.images ?? []).map((img) => {
    const up = uploadByField.get(img.field);
    if (!up) {
      throw new Error(
        `engine ingest: imagem declarada sem upload resolvido (field="${img.field}")`,
      );
    }
    if (!up.media_type.startsWith("image/")) {
      throw new Error(
        `engine ingest: upload "${img.field}" não é imagem (media_type="${up.media_type}")`,
      );
    }
    return {
      source_type: "file",
      label: img.label,
      file_id: up.file_id as CapturedEvidenceItem["file_id"],
      s3_key: up.s3_key,
      media_type: up.media_type,
      step_index: img.step_index,
      tool_name: img.tool_name,
      command: img.command,
      result_summary: img.result_summary,
    };
  });

  const evidence = uniquifyLabels([...textItems, ...imageItems]);

  return {
    engagementId: ingest.engagementId,
    userId: ingest.userId,
    origin: "agent",
    title: ingest.title,
    affectedAsset: ingest.affectedAsset,
    weaknessClass: ingest.weaknessClass,
    severity: normalizeSeverity(ingest.severity),
    description: ingest.description,
    impact: ingest.impact,
    remediation: ingest.remediation,
    narrative: ingest.narrative,
    reproductionSteps: ingest.reproductionSteps,
    cwe: ingest.cwe,
    cvssVector: ingest.cvssVector,
    cvssScore: ingest.cvssScore,
    confidence: ingest.confidence,
    evidence,
  };
}
