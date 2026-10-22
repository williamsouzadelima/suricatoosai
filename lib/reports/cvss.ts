/**
 * Cálculo DETERMINÍSTICO do CVSS 3.1 Base Score a partir do vetor (sem IA).
 *
 * Motivo: a captura/extração de achados grava o `cvss_vector` mas quase nunca o
 * `cvss_score` (extract-findings/ingest-bundle só emitem o vetor). Com isto, o
 * relatório deriva o score do vetor quando ele falta — enchendo a coluna CVSS,
 * o "CVSS MÉDIO" e o "MAIOR CVSS" (antes "—"). Retorna null p/ vetor inválido.
 *
 * Fórmula oficial (FIRST.org CVSS v3.1). Validado: AV:N/AC:L/PR:N/UI:N/S:U/
 * C:H/I:H/A:H → 9.8.
 */

const AV: Record<string, number> = { N: 0.85, A: 0.62, L: 0.55, P: 0.2 };
const AC: Record<string, number> = { L: 0.77, H: 0.44 };
const UI: Record<string, number> = { N: 0.85, R: 0.62 };
const CIA: Record<string, number> = { N: 0, L: 0.22, H: 0.56 };
// Privileges Required depende do Scope (Changed sobe o peso de L/H).
const PR_U: Record<string, number> = { N: 0.85, L: 0.62, H: 0.27 };
const PR_C: Record<string, number> = { N: 0.85, L: 0.68, H: 0.5 };

/** Roundup oficial do CVSS 3.1: menor número com 1 casa decimal >= input. */
function roundup(input: number): number {
  const i = Math.round(input * 100000);
  if (i % 10000 === 0) return i / 100000;
  return (Math.floor(i / 10000) + 1) / 10;
}

export function cvssBaseScore(vector?: string | null): number | null {
  if (!vector) return null;
  const p: Record<string, string> = {};
  for (const seg of vector.trim().split("/")) {
    const idx = seg.indexOf(":");
    if (idx > 0) p[seg.slice(0, idx).toUpperCase()] = seg.slice(idx + 1).toUpperCase();
  }
  const scope = p.S;
  const av = AV[p.AV];
  const ac = AC[p.AC];
  const ui = UI[p.UI];
  const pr = scope === "C" ? PR_C[p.PR] : PR_U[p.PR];
  const c = CIA[p.C];
  const i = CIA[p.I];
  const a = CIA[p.A];
  if (
    (scope !== "U" && scope !== "C") ||
    [av, ac, ui, pr, c, i, a].some((x) => x === undefined)
  ) {
    return null;
  }
  const iss = 1 - (1 - c) * (1 - i) * (1 - a);
  const impact =
    scope === "C"
      ? 7.52 * (iss - 0.029) - 3.25 * Math.pow(iss - 0.02, 15)
      : 6.42 * iss;
  if (impact <= 0) return 0;
  const expl = 8.22 * av * ac * pr * ui;
  return scope === "C"
    ? roundup(Math.min(1.08 * (impact + expl), 10))
    : roundup(Math.min(impact + expl, 10));
}
