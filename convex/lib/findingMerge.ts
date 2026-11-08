/**
 * Lógica PURA do merge de recaptura de achado (testável, sem ctx/db).
 * Usada SÓ pelo caminho do MOTOR em `captureFindingForBackend` (o chat de produção
 * tem o merge conservador INLINE em findings.ts, byte-idêntico ao de hoje).
 * `sameEvidenceContent` alimenta a dedup por conteúdo do motor
 * (`evidenceAlreadyPresentByContent`).
 *
 * Comportamento (o caller passa `latestWins=true` só no motor + draft de máquina
 * ainda não submetido):
 *  - #2: a avaliação mais nova SOBRESCREVE (severity/cvss/narrativa/steps/…); campo
 *    novo vazio NUNCA zera o existente. Em achado curado (in_review/analista) o
 *    caller passa `latestWins=false` → conservador (completa só TEXTO vazio; NÃO
 *    toca severidade nem CVSS).
 *  - #B1 (CVSS atômico): no latest-wins, vetor e score andam JUNTOS — score SEMPRE
 *    derivado do vetor; vetor inválido é ignorado; severidade que muda sem vetor
 *    válido limpa o par obsoleto. O conservador NÃO grava CVSS (evita incoerência).
 *  - #3/#B2/#M1 (dedup de evidência): por CONTEÚDO (rótulo+tipo+tamanho p/ imagem;
 *    rótulo+passo+trecho+comando+resultado p/ texto), não por ids que mudam a cada
 *    PUT.
 *
 * reviewed_by: `isMachineDraft` o checa como guarda, mas HOJE nada o grava. A
 * proteção efetiva é o STATUS: submeter (→ in_review) tira o draft do latest-wins.
 * ATENÇÃO: `updateFinding` JÁ edita um draft no lugar (hoje sem caller) e NÃO grava
 * reviewed_by nem muda o status — então, se uma UI editar um draft de agente e a
 * flag do motor estiver ligada, o próximo re-push faria latest-wins por cima. Hoje
 * o guard se sustenta só pela ausência de caller; ANTES de ligar a flag: gravar
 * reviewed_by em updateFinding p/ drafts de agente (ou recusar essas edições).
 */

import { cvssBaseScore } from "./cvss";

export type MergeableFinding = {
  status: string;
  created_by?: string;
  reviewed_by?: string | null;
  severity?: string;
  cvss_score?: number | null;
  cvss_vector?: string | null;
  narrative?: string | null;
  reproduction_steps?: string[] | null;
  confidence?: string | null;
  verdict?: string | null;
  description?: string | null;
  impact?: string | null;
  remediation?: string | null;
  cwe?: string | null;
};

export type MergeCaptureArgs = {
  origin: string;
  severity: string;
  description?: string;
  impact?: string;
  remediation?: string;
  narrative?: string;
  cwe?: string;
  cvssVector?: string;
  cvssScore?: number;
  reproductionSteps?: string[];
  confidence?: string;
  verdict?: string;
};

export type MergeHelpers = {
  clampText: (s: string | undefined) => string | undefined;
  clampSteps: (s: string[] | undefined) => string[] | undefined;
};

/**
 * "Tem conteúdo?" — string só de espaços ou vazia conta como VAZIA (#L2), para
 * não sobrescrever/preencher um campo com espaço em branco.
 */
function nonEmpty(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === "string") return v.trim() !== "";
  return true;
}

/** Remove passos vazios/só-espaço (#L2): `[""]`/`["  "]` → `[]`. */
function cleanSteps(steps: string[] | undefined): string[] | undefined {
  if (steps === undefined) return undefined;
  return steps.filter((s) => typeof s === "string" && s.trim() !== "");
}

/**
 * Um DRAFT criado pela MÁQUINA (created_by="agent"), AINDA não marcado como curado
 * (sem reviewed_by), re-empurrado por máquina (origin != "analyst"): elegível a
 * latest-wins. Fora disso → conservador. NOTA: hoje NADA grava reviewed_by — a
 * proteção real é o STATUS (submeter tira do "draft"). Ver o cabeçalho do módulo:
 * updateFinding já edita draft no lugar sem gravar reviewed_by, então antes de
 * ligar a flag do motor é preciso gravá-lo (ou recusar edição de draft de agente).
 */
export function isMachineDraft(
  m: { status: string; created_by?: string; reviewed_by?: string | null },
  repushOrigin: string,
): boolean {
  return (
    m.status === "draft" &&
    m.created_by === "agent" &&
    !nonEmpty(m.reviewed_by) &&
    repushOrigin !== "analyst"
  );
}

/**
 * Patch do merge (sem `updated_at` — o caller adiciona). Só inclui campos que
 * REALMENTE mudam (updatedFields é honesto). Textos já clampados via helpers.
 */
export function computeMergePatch(
  mergeable: MergeableFinding,
  args: MergeCaptureArgs,
  helpers: MergeHelpers,
  latestWins: boolean,
): { patch: Record<string, unknown>; updatedFields: string[] } {
  const { clampText, clampSteps } = helpers;
  const patch: Record<string, unknown> = {};
  const updatedFields: string[] = [];

  // `latestWins` é decidido pelo caller (SÓ a captura do motor, em um draft de
  // máquina ainda não curado — ver findings.ts). O chat de produção nunca chega
  // aqui no modo latest-wins: cai no ramo conservador (preenche só vazios).
  if (latestWins) {
    // latest-wins: campo novo NÃO-vazio sobrescreve o existente SE mudou.
    const over = (key: string, next: unknown, prev: unknown) => {
      if (!nonEmpty(next)) return;
      if (String(next) === String(prev ?? "")) return;
      patch[key] = next;
      updatedFields.push(key);
    };
    over("severity", args.severity, mergeable.severity);
    over("description", clampText(args.description), mergeable.description);
    over("impact", clampText(args.impact), mergeable.impact);
    over("remediation", clampText(args.remediation), mergeable.remediation);
    over("narrative", clampText(args.narrative), mergeable.narrative);
    over("cwe", args.cwe, mergeable.cwe);
    over("confidence", args.confidence, mergeable.confidence);
    over("verdict", args.verdict, mergeable.verdict);

    // CVSS ATÔMICO (#B1): vetor e score NUNCA divergem.
    //  - vetor novo VÁLIDO → grava vetor + score DERIVADO dele (ignora score
    //    inconsistente enviado);
    //  - vetor novo inválido/incompleto (não parseia) → IGNORADO (nunca grava
    //    lixo que depois conviva com um score de outro vetor);
    //  - severidade mudou e NÃO veio vetor válido → LIMPA o par antigo (ele
    //    contradiz a nova severidade) → relatório mostra "—" até nova avaliação;
    //  - score-sem-vetor só é aceito quando NÃO há vetor armazenado a contradizer.
    const prevVector = nonEmpty(mergeable.cvss_vector)
      ? String(mergeable.cvss_vector)
      : undefined;
    const prevScore = mergeable.cvss_score ?? undefined;
    const rawNewVector = nonEmpty(args.cvssVector)
      ? String(args.cvssVector)
      : undefined;
    const derivedFromNew =
      rawNewVector !== undefined ? cvssBaseScore(rawNewVector) : null;
    const severityChanged = updatedFields.includes("severity");
    if (derivedFromNew !== null) {
      const newVector = rawNewVector as string;
      if (newVector !== prevVector) {
        patch.cvss_vector = newVector;
        updatedFields.push("cvss_vector");
      }
      if (derivedFromNew !== prevScore) {
        patch.cvss_score = derivedFromNew;
        updatedFields.push("cvss_score");
      }
    } else if (severityChanged) {
      if (prevVector !== undefined) {
        patch.cvss_vector = undefined;
        updatedFields.push("cvss_vector");
      }
      if (prevScore !== undefined) {
        patch.cvss_score = undefined;
        updatedFields.push("cvss_score");
      }
    } else if (
      prevVector === undefined &&
      args.cvssScore !== undefined &&
      args.cvssScore !== null
    ) {
      if (args.cvssScore !== prevScore) {
        patch.cvss_score = args.cvssScore;
        updatedFields.push("cvss_score");
      }
    }

    const steps = cleanSteps(args.reproductionSteps);
    if (steps && steps.length > 0) {
      const clamped = clampSteps(steps);
      if (
        JSON.stringify(clamped ?? null) !==
        JSON.stringify(mergeable.reproduction_steps ?? null)
      ) {
        patch.reproduction_steps = clamped;
        updatedFields.push("reproduction_steps");
      }
    }
  } else {
    // Conservador (preserva curadoria de in_review / analista): completa só campos
    // de TEXTO vazios, nunca sobrescreve. Deliberadamente NÃO toca CVSS (#1):
    // preencher um vetor sem o score derivado — e sem mexer na severidade, que o
    // conservador também preserva — criaria incoerência vetor↔score↔severidade
    // (ex.: vetor que deriva 9.8 ao lado de severidade "low"). Em achado curado, o
    // CVSS fica o que o analista decidiu; o motor não o altera.
    const fill = (key: string, next: unknown, prev: unknown) => {
      if (!nonEmpty(prev) && nonEmpty(next)) {
        patch[key] = next;
        updatedFields.push(key);
      }
    };
    fill("description", clampText(args.description), mergeable.description);
    fill("impact", clampText(args.impact), mergeable.impact);
    fill("remediation", clampText(args.remediation), mergeable.remediation);
    fill("narrative", clampText(args.narrative), mergeable.narrative);
    fill("cwe", args.cwe, mergeable.cwe);
  }

  return { patch, updatedFields };
}

export type EvidenceContent = {
  source_type?: string | null;
  label?: string | null;
  media_type?: string | null;
  size?: number | null;
  step_index?: number | null;
  snippet?: string | null;
  command?: string | null;
  result_summary?: string | null;
  file_id?: unknown;
  s3_key?: unknown;
};

/** Evidência de ARQUIVO (imagem/print) — identificada por source_type "file". */
function isFileEvidence(e: EvidenceContent): boolean {
  return (e.source_type ?? "") === "file";
}

/**
 * Duas evidências são a MESMA?
 *  - ARQUIVO (imagem): rótulo + tipo + TAMANHO em bytes. file_id/s3_key NÃO entram
 *    (são novos a cada upload → senão o mesmo print re-empurrado nunca dedupa, #B2).
 *    LIMITE: a identidade é só rótulo+tipo+tamanho — dois prints DIFERENTES com o
 *    mesmo rótulo, tipo e tamanho exato em bytes colapsam (raro e silencioso); um
 *    content-hash (sha256) seria o endurecimento. Não é "nunca perde", é "quase
 *    nunca" (mesma ressalva em lib/engine/map-finding).
 *  - TEXTO: rótulo + passo + trecho + comando + resultado (#3/#M1). Dois itens que
 *    diferem só no rótulo/passo NÃO colapsam; conteúdo idêntico dedup. (snippet
 *    deve vir já clampado pelo caller p/ casar com o gravado.)
 */
export function sameEvidenceContent(a: EvidenceContent, b: EvidenceContent): boolean {
  const s = (v: unknown) => (v === undefined || v === null ? "" : String(v));
  if (s(a.source_type) !== s(b.source_type)) return false;
  if (isFileEvidence(a)) {
    return (
      s(a.label) === s(b.label) &&
      s(a.media_type) === s(b.media_type) &&
      s(a.size) === s(b.size)
    );
  }
  return (
    s(a.label) === s(b.label) &&
    s(a.step_index) === s(b.step_index) &&
    s(a.snippet) === s(b.snippet) &&
    s(a.command) === s(b.command) &&
    s(a.result_summary) === s(b.result_summary)
  );
}
