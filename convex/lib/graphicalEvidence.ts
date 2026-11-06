/**
 * Política "evidência gráfica obrigatória" (requisito do operador): um achado só
 * pode ser aprovado/publicado/entregue com ao menos UMA evidência de imagem
 * (screenshot da invasão). Controlada por flag global para rollout seguro:
 * desligada = comportamento de hoje (zero retrocesso), ligada = garantia.
 *
 * O predicado de imagem espelha exatamente o usado na leitura
 * (findings.getEngagementImageEvidenceCounts / listEvidenceForFinding):
 * referencia um arquivo/objeto S3 E tem media_type image/*.
 */

export type EvidenceLike = {
  file_id?: string | null;
  s3_key?: string | null;
  media_type?: string | null;
};

/** Conta como evidência GRÁFICA: tem file_id|s3_key E media_type image/*. */
export function isImageEvidence(e: EvidenceLike): boolean {
  return Boolean(e.file_id || e.s3_key) && (e.media_type ?? "").startsWith("image/");
}

/** Política global via env do Convex; default OFF = comportamento de hoje. */
export function requireGraphicalEvidenceEnabled(): boolean {
  return process.env.REQUIRE_GRAPHICAL_EVIDENCE === "true";
}

export type GateVerdict =
  | { ok: true }
  | { ok: false; code: "NO_EVIDENCE" | "NO_GRAPHICAL_EVIDENCE" };

/**
 * Decide o portão de aprovação dado o conjunto de evidências e se a política
 * gráfica está ligada. PURO (testável): sempre exige ≥1 evidência; com a
 * política ligada, exige ≥1 evidência de imagem.
 */
export function evaluateApprovalGate(opts: {
  graphicalRequired: boolean;
  evidences: EvidenceLike[];
}): GateVerdict {
  if (opts.evidences.length === 0) {
    return { ok: false, code: "NO_EVIDENCE" };
  }
  if (opts.graphicalRequired && !opts.evidences.some(isImageEvidence)) {
    return { ok: false, code: "NO_GRAPHICAL_EVIDENCE" };
  }
  return { ok: true };
}
