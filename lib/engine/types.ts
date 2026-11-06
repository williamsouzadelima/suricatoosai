/**
 * Contrato de ingestão do "motor autônomo" (engine) — fonte externa de achados.
 *
 * Codinome deliberado: NADA aqui nomeia a origem real do motor. É só mais uma
 * FONTE de achados, ao lado do agente ao vivo e do bundle-ingest. O sidecar que
 * roda ao lado do motor monta este payload e faz POST (multipart: este JSON +
 * os arquivos de imagem) para o endpoint do platform, que empurra pelo seam
 * provado (captureFindingForBackend, sempre em draft).
 *
 * Este módulo é PURO (sem I/O, sem "server-only") para ser testável no jest.
 */

export type EngineSeverity = "info" | "low" | "medium" | "high" | "critical";

export type EngineConfidence = "low" | "medium" | "high";

/** Evidência textual (ex.: troca HTTP do MITM, saída de comando). */
export type EngineEvidenceText = {
  label: string;
  snippet?: string;
  /** Mapeado 1:1 para evidence.source_type; default "note". */
  source_type?: "http" | "tool_output" | "command" | "note";
  command?: string;
  result_summary?: string;
  step_index?: number;
  tool_name?: string;
};

/**
 * Metadados de UMA imagem de evidência. Os bytes vêm no multipart sob `field`;
 * o endpoint sobe ao S3 e resolve file_id/s3_key antes do mapeamento final.
 */
export type EngineEvidenceImageMeta = {
  /** Nome do campo multipart que carrega os bytes desta imagem. */
  field: string;
  label: string;
  /** default "image/png". */
  media_type?: string;
  step_index?: number;
  /** ferramenta/superfície: "browser" | "ssh" | "rdp" | "sqlmap" | ... */
  tool_name?: string;
  command?: string;
  result_summary?: string;
  /** Superfície/protocolo para cadeia de custódia: "web"|"ssh"|"rdp"|"sqlmap"|... */
  surface?: string;
};

/**
 * Payload JSON que o sidecar envia por achado. engineTaskId/engineFindingId são
 * só para correlação/idempotência DO LADO DO SIDECAR — NÃO entram em nenhum
 * campo da tabela do platform (dedup por conteúdo via fingerprint já garante
 * idempotência, e não gravar id externo evita qualquer pista da origem).
 */
export type EngineFindingIngest = {
  engineTaskId?: string;
  engineFindingId?: string;
  /** Mapeamento explícito task-do-motor ↔ engajamento (feito pelo operador). */
  engagementId: string;
  /** Operador dono (a tenancy é derivada do engajamento no lado do Convex). */
  userId: string;
  title: string;
  affectedAsset: string;
  weaknessClass: string;
  /** String livre do motor; normalizada/validada em normalizeSeverity (um de EngineSeverity). */
  severity: string;
  description?: string;
  impact?: string;
  remediation?: string;
  /** Relatório Markdown do motor → vira o narrative do achado. */
  narrative?: string;
  reproductionSteps?: string[];
  cwe?: string;
  cvssVector?: string;
  cvssScore?: number;
  confidence?: EngineConfidence;
  textEvidence?: EngineEvidenceText[];
  images?: EngineEvidenceImageMeta[];
};

/** Upload já resolvido de uma imagem (saída do passo de I/O do endpoint). */
export type ResolvedImageUpload = {
  /** Casa com EngineEvidenceImageMeta.field. */
  field: string;
  file_id: string;
  s3_key: string;
  media_type: string;
};
