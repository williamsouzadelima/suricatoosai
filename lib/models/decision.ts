/**
 * "Pregão de LLMs" — camada de DECISÃO (fecha o A/B). Read-only, sem hot-path.
 *
 * Funde as métricas REAIS medidas pelo eval-gate (validação de achados,
 * tool-sucesso, custo faturado, latência — por modelo SERVIDO) numa recomendação
 * por tier. Diferente do exchange.ts (v1), que blendava PREÇO de tabela do
 * mercado com qualidade NEUTRA (0.5); aqui a qualidade é a medida de verdade.
 *
 * Princípio inegociável: NÃO recomendar sem sinal. Toda taxa passa por intervalo
 * de Wilson (95%) + piso de amostra próprio; um "trocar" só sai quando qualidade
 * E tool-sucesso foram MEDIDOS e não regridem, com ganho real (qualidade melhor
 * OU custo faturado menor sobre amostra suficiente). AUSÊNCIA de medição (no_data)
 * NUNCA conta como "não regrediu" — vira "insuficiente", nunca "trocar" nem um
 * "manter" que finja significância. Ver [[medicao-em-producao-mente-tres-modos]],
 * [[portao-ausencia-de-lixo-nao-e-presenca]].
 */

import {
  CANDIDATES,
  CURRENT_ASSIGNMENT,
  TIER_LABELS,
  type TierId,
} from "./exchange";

/** Linha de entrada — subconjunto do que /api/admin/model-quality já devolve. */
export interface EvalRow {
  slug: string;
  label: string;
  assistantMessages: number;
  findingsValidated: number;
  findingsDismissed: number;
  toolCalls: number;
  toolErrors: number;
  /** Custo REAL faturado (provider_billed), NÃO o estimado. Só linhas com faturamento. */
  billedCost: number;
  /** Requisições que TÊM custo faturado real (denominador homogêneo do custo/req). */
  billedRequests: number;
  latencyP50Ms: number | null;
  hasData: boolean;
}

export interface RateStat {
  rate: number; // p pontual
  lo: number; // Wilson inferior (95%)
  hi: number; // Wilson superior (95%)
  n: number; // tamanho da amostra (denominador)
}

export type Verdict = "switch" | "keep" | "insufficient";
type RateCmp = "cand_better" | "cur_better" | "inconclusive" | "no_data";
type CostCmp = "cand_cheaper" | "cur_cheaper" | "similar" | "no_data";

export interface MetricComparison {
  curValidation: RateStat | null;
  candValidation: RateStat | null;
  qualityCmp: RateCmp;
  curTool: RateStat | null;
  candTool: RateStat | null;
  toolCmp: RateCmp;
  curCostPerReq: number | null;
  candCostPerReq: number | null;
  costCmp: CostCmp;
  curLatencyMs: number | null;
  candLatencyMs: number | null;
}

export interface TierDecision {
  tier: TierId;
  tierLabel: string;
  currentSlug: string;
  currentLabel: string;
  verdict: Verdict;
  /** Desafiante da comparação exibida (recomendado no "switch"; o de melhor
   *  evidência no "keep"/"insufficient" com contexto). null quando não houve. */
  challengerSlug: string | null;
  challengerLabel: string | null;
  reason: string;
  comparison: MetricComparison | null;
}

export interface DecideOpts {
  /** A leitura de qualidade FALHOU (não é "zero medido"). */
  qualityUnavailable?: boolean;
  /** A leitura de custo FALHOU (o eixo custo vira indisponível, não "grátis"). */
  costUnavailable?: boolean;
}

// z de 95% (bicaudal).
const Z = 1.96;
// Pisos de amostra (documentados; conservadores). Cada métrica tem o seu, sobre
// o próprio denominador — msgs, achados curados, tool-calls, requisições faturadas.
export const MIN_MSGS = 20; // o modelo precisa ter sido exercitado na janela
export const MIN_CURATED = 10; // validados+descartados p/ a taxa de validação valer
export const MIN_TOOLCALLS = 30; // tool-calls p/ o tool-sucesso valer
export const MIN_REQUESTS = 20; // requisições faturadas p/ o custo/req valer
export const COST_MARGIN = 0.1; // 10% p/ "mais barato" contar (fora do ruído)

/**
 * Intervalo de Wilson (95%) para uma proporção binomial. Estável mesmo com n
 * pequeno e p perto de 0/1 — por isso é preferível ao intervalo normal aqui.
 */
export function wilson(successes: number, n: number): RateStat | null {
  if (n <= 0 || successes < 0 || successes > n) return null;
  const p = successes / n;
  const z2 = Z * Z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (Z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return {
    rate: p,
    lo: Math.max(0, center - half),
    hi: Math.min(1, center + half),
    n,
  };
}

function curatedTotal(r: EvalRow): number {
  return r.findingsValidated + r.findingsDismissed;
}
/** Taxa de validação (achados aprovados/publicados ÷ curados), com IC — só quando há curadoria suficiente. */
function validationStat(r: EvalRow): RateStat | null {
  const n = curatedTotal(r);
  return n >= MIN_CURATED ? wilson(r.findingsValidated, n) : null;
}
/** Tool-sucesso (execuções sem exceção ÷ tool-calls), com IC — só com chamadas suficientes. */
function toolStat(r: EvalRow): RateStat | null {
  return r.toolCalls >= MIN_TOOLCALLS
    ? wilson(r.toolCalls - r.toolErrors, r.toolCalls)
    : null;
}
/** Custo real por requisição FATURADA — só com custo faturado (>0) e requisições
 *  faturadas suficientes. Nunca mistura dólar estimado; nunca compara ponto ruidoso. */
function costPerReq(r: EvalRow): number | null {
  return r.billedRequests >= MIN_REQUESTS && r.billedCost > 0
    ? r.billedCost / r.billedRequests
    : null;
}

/**
 * Compara duas taxas por SOBREPOSIÇÃO de IC de Wilson (conservador — não vira no
 * ruído): "melhor" só quando o inferior de um supera o superior do outro. Se
 * QUALQUER lado não foi medido → "no_data" (ausência, não empate).
 */
function compareRates(cur: RateStat | null, cand: RateStat | null): RateCmp {
  if (!cur || !cand) return "no_data";
  if (cand.lo > cur.hi) return "cand_better";
  if (cand.hi < cur.lo) return "cur_better";
  return "inconclusive";
}

function compareCost(cur: number | null, cand: number | null): CostCmp {
  if (cur == null || cand == null) return "no_data";
  if (cand < cur * (1 - COST_MARGIN)) return "cand_cheaper";
  if (cand > cur * (1 + COST_MARGIN)) return "cur_cheaper";
  return "similar";
}

function labelOf(slug: string): string {
  return CANDIDATES.find((c) => c.slug === slug)?.label ?? slug;
}

function pct(s: RateStat | null): string {
  return s ? `${Math.round(s.rate * 100)}% [n=${s.n}]` : "s/ amostra";
}

function buildComparison(cur: EvalRow, cand: EvalRow): MetricComparison {
  const curV = validationStat(cur);
  const candV = validationStat(cand);
  const curT = toolStat(cur);
  const candT = toolStat(cand);
  const curC = costPerReq(cur);
  const candC = costPerReq(cand);
  return {
    curValidation: curV,
    candValidation: candV,
    qualityCmp: compareRates(curV, candV),
    curTool: curT,
    candTool: candT,
    toolCmp: compareRates(curT, candT),
    curCostPerReq: curC,
    candCostPerReq: candC,
    costCmp: compareCost(curC, candC),
    curLatencyMs: cur.latencyP50Ms,
    candLatencyMs: cand.latencyP50Ms,
  };
}

interface Challenge {
  row: EvalRow;
  cmp: MetricComparison;
  winner: boolean;
  qualityComparable: boolean;
}

/** Um eixo de taxa está MEDIDO e não pior quando o cmp é cand_better ou inconclusive
 *  (ambos os lados tiveram amostra). "no_data" (ausência) e "cur_better" reprovam. */
function measuredNotWorse(cmp: RateCmp): boolean {
  return cmp === "cand_better" || cmp === "inconclusive";
}

/**
 * Um concorrente "vence" (troca) só quando qualidade E tool-sucesso foram MEDIDOS
 * e não regridem, e há ganho real: qualidade melhor (IC separado) OU custo
 * faturado menor sobre amostra suficiente. Ausência de medição (no_data) NUNCA
 * satisfaz "não regride" — o eixo faltante bloqueia a troca.
 */
function isWinner(cmp: MetricComparison): boolean {
  const qualityOk = measuredNotWorse(cmp.qualityCmp);
  const toolOk = measuredNotWorse(cmp.toolCmp);
  const gain =
    cmp.qualityCmp === "cand_better" || cmp.costCmp === "cand_cheaper";
  return qualityOk && toolOk && gain;
}

/** Ordena vencedores: ganho de qualidade > só-mais-barato; depois mais barato,
 *  MAIOR limite inferior de Wilson da validação (evidência mais robusta que a
 *  taxa pontual), mais mensagens. */
function winnerRank(c: Challenge): [number, number, number, number] {
  const q = c.cmp.qualityCmp === "cand_better" ? 1 : 0;
  const cheap = c.cmp.costCmp === "cand_cheaper" ? 1 : 0;
  const lo = c.cmp.candValidation?.lo ?? 0;
  return [q, cheap, lo, c.row.assistantMessages];
}
function cmpTuple(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return b[i] - a[i];
  return 0;
}

function switchReason(cmp: MetricComparison, candLabel: string): string {
  const parts: string[] = [];
  if (cmp.qualityCmp === "cand_better") {
    parts.push(
      `valida mais achados (${pct(cmp.candValidation)} vs ${pct(cmp.curValidation)}, IC 95% sem sobreposição)`,
    );
  } else {
    // Só chega aqui com qualidade MEDIDA e inconclusiva (isWinner exige medida).
    parts.push(
      `qualidade equivalente (${pct(cmp.candValidation)} vs ${pct(cmp.curValidation)})`,
    );
  }
  if (cmp.costCmp === "cand_cheaper" && cmp.candCostPerReq && cmp.curCostPerReq) {
    const save = Math.round((1 - cmp.candCostPerReq / cmp.curCostPerReq) * 100);
    parts.push(`${save}% mais barato por requisição faturada`);
  } else if (cmp.costCmp === "cur_cheaper") {
    parts.push("porém mais caro (o ganho é de qualidade)");
  }
  if (cmp.toolCmp === "cand_better") parts.push("e melhor tool-sucesso");
  return `Trocar para ${candLabel}: ${parts.join("; ")}. Verificar antes de aplicar.`;
}

function keepReason(cmp: MetricComparison): string {
  const eixos =
    cmp.toolCmp !== "no_data"
      ? "Qualidade e tool-sucesso comparados (IC 95%)"
      : "Qualidade comparada (IC 95%)";
  return `${eixos}: nenhum concorrente supera o atual sem regredir. Manter.`;
}

/**
 * Decide por tier a partir das linhas do eval-gate (uma por candidato, chaveadas
 * por slug). Puro e testável. NÃO aplica nada — só recomenda. `opts` distingue
 * FALHA de leitura de "zero medido".
 */
export function decidePerTier(
  rows: EvalRow[],
  opts: DecideOpts = {},
): TierDecision[] {
  const bySlug = new Map(rows.map((r) => [r.slug, r]));

  return (["standard", "pro", "max"] as TierId[]).map((tier) => {
    const currentSlug = CURRENT_ASSIGNMENT[tier];
    const currentLabel = labelOf(currentSlug);
    const base = {
      tier,
      tierLabel: TIER_LABELS[tier],
      currentSlug,
      currentLabel,
      challengerSlug: null,
      challengerLabel: null,
      comparison: null,
    };

    // Falha de leitura da qualidade → INDISPONÍVEL, não "zero medido". Não citar
    // "0 msgs / rode mais tasks" (a remediação não resolveria uma falha de leitura).
    if (opts.qualityUnavailable) {
      return {
        ...base,
        verdict: "insufficient" as const,
        reason:
          "Medição de qualidade indisponível agora (falha de leitura) — não é zero medido. Nada a recomendar até a leitura voltar.",
      };
    }

    const currentRow = bySlug.get(currentSlug);
    // Piso: o atual precisa ter sido exercitado o suficiente p/ servir de baseline.
    if (!currentRow || currentRow.assistantMessages < MIN_MSGS) {
      return {
        ...base,
        verdict: "insufficient" as const,
        reason: `Amostra insuficiente no modelo atual (${currentRow?.assistantMessages ?? 0} msgs; mín ${MIN_MSGS}). Rode mais tasks no atual para criar baseline.`,
      };
    }

    // Concorrentes do tier COM amostra mínima de mensagens (excluindo o atual).
    const challengers = CANDIDATES.filter(
      (c) => c.tiers.includes(tier) && c.slug !== currentSlug,
    )
      .map((c) => bySlug.get(c.slug))
      .filter((r): r is EvalRow => !!r && r.assistantMessages >= MIN_MSGS);

    if (challengers.length === 0) {
      return {
        ...base,
        verdict: "insufficient" as const,
        reason: `Nenhum concorrente com amostra suficiente neste tier (mín ${MIN_MSGS} msgs). Rode tasks escolhendo os modelos concorrentes para comparar.`,
      };
    }

    const evals: Challenge[] = challengers.map((row) => {
      const cmp = buildComparison(currentRow, row);
      return {
        row,
        cmp,
        winner: isWinner(cmp),
        qualityComparable: cmp.qualityCmp !== "no_data",
      };
    });

    const winners = evals
      .filter((e) => e.winner)
      .sort((a, b) => cmpTuple(winnerRank(a), winnerRank(b)));
    if (winners.length > 0) {
      const w = winners[0];
      return {
        ...base,
        verdict: "switch" as const,
        challengerSlug: w.row.slug,
        challengerLabel: w.row.label,
        reason: switchReason(w.cmp, w.row.label),
        comparison: w.cmp,
      };
    }

    // Sem vencedor. Só se pode "manter" com honestidade se a QUALIDADE foi de fato
    // comparada (ambos ≥ MIN_CURATED). Senão, é "insuficiente" — não medimos o eixo
    // que importa; um "manter" fingiria uma verificação que não houve (achado #4).
    const comparable = evals.filter((e) => e.qualityComparable);

    // Vantagem MEDIDA mas bloqueada só por eixo NÃO medido (tool-sucesso): não é
    // "manter" — o concorrente supera no eixo que medimos e o bloqueio é ausência
    // de medição de tool, não regressão. Um "keep" aqui fingiria a verificação de
    // tool que não houve. Vira "insuficiente" honesto (segunda revisão).
    const blocked = comparable
      .filter((e) => {
        const c = e.cmp;
        const gain =
          c.qualityCmp === "cand_better" || c.costCmp === "cand_cheaper";
        const noRegression =
          c.qualityCmp !== "cur_better" && c.toolCmp !== "cur_better";
        return gain && noRegression && c.toolCmp === "no_data";
      })
      .sort(
        (a, b) =>
          (b.cmp.candValidation?.lo ?? 0) - (a.cmp.candValidation?.lo ?? 0),
      );
    if (blocked.length > 0) {
      const b0 = blocked[0];
      const edge =
        b0.cmp.qualityCmp === "cand_better" ? "qualidade melhor" : "custo menor";
      return {
        ...base,
        verdict: "insufficient" as const,
        challengerSlug: b0.row.slug,
        challengerLabel: b0.row.label,
        reason: `${b0.row.label} tem vantagem medida (${edge}), mas o tool-sucesso não foi medido (mín ${MIN_TOOLCALLS} tool-calls) — não dá para confirmar não-regressão de confiabilidade. Rode mais tasks nesse modelo para decidir.`,
        comparison: b0.cmp, // qualidade foi comparada → grade honesta
      };
    }

    // "Manter" honesto: houve comparação de qualidade e nenhum concorrente supera
    // o atual sem regredir (ou o único ganho vem com regressão em outro eixo medido).
    const genuineKeep = comparable.sort(
      (a, b) => (b.cmp.candValidation?.n ?? 0) - (a.cmp.candValidation?.n ?? 0),
    );
    if (genuineKeep.length > 0) {
      const rep = genuineKeep[0];
      return {
        ...base,
        verdict: "keep" as const,
        challengerSlug: rep.row.slug,
        challengerLabel: rep.row.label,
        reason: keepReason(rep.cmp),
        comparison: rep.cmp,
      };
    }

    // Nenhum par teve qualidade medida em AMBOS os lados → não houve comparação de
    // qualidade. NÃO anexa grade (não insinuar um número unilateral). Distingue a
    // causa: se o ATUAL está sem curadoria, a lacuna é dele, não dos concorrentes.
    const rep = evals
      .slice()
      .sort((a, b) => b.row.assistantMessages - a.row.assistantMessages)[0];
    const currentUncurated = validationStat(currentRow) === null;
    return {
      ...base,
      verdict: "insufficient" as const,
      challengerSlug: rep.row.slug,
      challengerLabel: rep.row.label,
      reason: currentUncurated
        ? `O modelo atual (${currentLabel}) tem só ${curatedTotal(currentRow)} achados curados (mín ${MIN_CURATED}) — sem baseline de qualidade. Cure os achados do ATUAL para poder comparar.`
        : `Concorrentes rodaram, mas sem curadoria suficiente para comparar qualidade (mín ${MIN_CURATED} achados curados por modelo). Cure os achados desses modelos para decidir.`,
      comparison: null,
    };
  });
}
