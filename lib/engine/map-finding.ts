/**
 * Mapeamento PURO: payload de ingestão do motor → args de captureFindingForBackend
 * (menos serviceKey/dedupFingerprint, que o módulo server-only resolve).
 *
 * Aplica os cuidados verificados na fonte de convex/findings.ts:
 *  - evidência de imagem SEMPRE source_type:"file" + file_id + s3_key + media_type
 *    image/* (file_id é o que sobrevive ao purge de 24h; media_type image/* é o
 *    que a galeria/relatório tratam como imagem);
 *  - LABEL ÚNICO por item: a dedup de evidência no merge usa o RÓTULO como parte
 *    da identidade (imagem = source_type+rótulo+media_type+tamanho; texto =
 *    rótulo+passo+trecho+comando+resultado). Dois artefatos DISTINTOS no mesmo
 *    push com rótulo igual colidiriam, então uniquificamos os rótulos ("X",
 *    "X (2)", …) — nunca se perde um print; uma recaptura do MESMO print (mesmo
 *    rótulo+tipo+tamanho) ainda dedupa.
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

// #10 SIGILO: só repassa tool_name de uma allowlist de superfícies/ferramentas
// genéricas; qualquer outro valor (ex. nome interno de ferramenta do motor) cai
// para "tool" — o nome real nunca chega ao relatório/entregável.
const ALLOWED_TOOL_NAMES = new Set([
  "browser", "ssh", "rdp", "vnc", "sqlmap", "http", "https", "terminal",
  "shell", "cli", "nmap", "nuclei", "gowitness", "playwright", "command",
  "curl", "ffuf", "katana", "httpx",
]);
function clampToolName(t?: string): string | undefined {
  if (!t) return undefined;
  return ALLOWED_TOOL_NAMES.has(t.toLowerCase()) ? t.toLowerCase() : "tool";
}

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
 * Garante label GLOBALMENTE único no conjunto de evidência. Mantém o primeiro uso
 * de cada rótulo; para repetidos, acha o 1º sufixo " (n)" LIVRE comparando contra
 * TODOS os rótulos finais já usados — inclusive os que já vieram com sufixo
 * literal (ex.: ["X","X","X (2)"] → "X","X (2)","X (2) (2)", nunca dois "X (2)").
 * Nota: a identidade de imagem no dedup do motor é rótulo+tipo+tamanho; um
 * content-hash (sha256) seria endurecimento futuro contra colisão de tamanho.
 */
function uniquifyLabels(items: CapturedEvidenceItem[]): CapturedEvidenceItem[] {
  const used = new Set<string>();
  return items.map((item) => {
    const base = item.label ?? "";
    if (!used.has(base)) {
      used.add(base);
      return item;
    }
    let n = 2;
    let candidate = `${base} (${n})`;
    while (used.has(candidate)) {
      n += 1;
      candidate = `${base} (${n})`;
    }
    used.add(candidate);
    return { ...item, label: candidate };
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
      tool_name: clampToolName(t.tool_name),
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
      tool_name: clampToolName(img.tool_name),
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
