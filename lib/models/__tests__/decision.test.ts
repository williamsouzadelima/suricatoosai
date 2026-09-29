import { describe, it, expect } from "@jest/globals";
import {
  wilson,
  decidePerTier,
  MIN_MSGS,
  MIN_REQUESTS,
  MIN_TOOLCALLS,
  type EvalRow,
  type TierDecision,
} from "../decision";
import { CANDIDATES, CURRENT_ASSIGNMENT } from "../exchange";

function row(slug: string, o: Partial<EvalRow> = {}): EvalRow {
  return {
    slug,
    label: slug,
    assistantMessages: 0,
    findingsValidated: 0,
    findingsDismissed: 0,
    toolCalls: 0,
    toolErrors: 0,
    billedCost: 0,
    billedRequests: 0,
    latencyP50Ms: null,
    hasData: true,
    ...o,
  };
}
const byTier = (ds: TierDecision[], t: string) =>
  ds.find((d) => d.tier === t)!;

const CUR_MAX = CURRENT_ASSIGNMENT.max; // x-ai/grok-4.6
const GROK_47 = "x-ai/grok-4.7";
const CUR_STD = CURRENT_ASSIGNMENT.standard;

/** Baseline atual do tier max: qualidade e tool MEDIDOS, custo faturado presente. */
const curBase = () =>
  row(CUR_MAX, {
    assistantMessages: 60,
    findingsValidated: 20,
    findingsDismissed: 20, // taxa 0.5, n=40
    toolCalls: 100,
    toolErrors: 5,
    billedRequests: 50,
    billedCost: 50, // $1.00/req
    latencyP50Ms: 800,
  });

describe("wilson", () => {
  it("rejeita n inválido ou successes fora de [0,n]", () => {
    expect(wilson(0, 0)).toBeNull();
    expect(wilson(-1, 5)).toBeNull();
    expect(wilson(6, 5)).toBeNull();
  });

  it("centra na proporção e encapsula a taxa (n=100, p=0.5 → ~[0.40,0.60])", () => {
    const s = wilson(50, 100)!;
    expect(s.rate).toBeCloseTo(0.5, 5);
    expect(s.lo).toBeCloseTo(0.404, 2);
    expect(s.hi).toBeCloseTo(0.596, 2);
    expect(s.lo).toBeLessThan(s.rate);
    expect(s.hi).toBeGreaterThan(s.rate);
  });

  it("estreita com mais amostra na mesma proporção", () => {
    const wide = wilson(4, 5)!;
    const narrow = wilson(400, 500)!;
    expect(narrow.hi - narrow.lo).toBeLessThan(wide.hi - wide.lo);
  });
});

describe("decidePerTier — pisos de amostra", () => {
  it("atual abaixo do piso de mensagens → insuficiente (sem chute)", () => {
    const d = byTier(decidePerTier([row(CUR_MAX, { assistantMessages: 5 })]), "max");
    expect(d.verdict).toBe("insufficient");
    expect(d.challengerSlug).toBeNull();
    expect(d.reason).toMatch(/baseline|insuficiente/i);
  });

  it("atual com amostra mas sem concorrente qualificado → insuficiente", () => {
    const d = byTier(
      decidePerTier([
        curBase(),
        // desafiante existe mas NÃO atinge o piso de mensagens → filtrado
        row(GROK_47, { assistantMessages: MIN_MSGS - 1, findingsValidated: 30 }),
      ]),
      "max",
    );
    expect(d.verdict).toBe("insufficient");
    expect(d.reason).toMatch(/concorrente/i);
  });
});

describe("decidePerTier — veredito com significância", () => {
  it("troca quando o concorrente valida mais achados com IC 95% separado", () => {
    const d = byTier(
      decidePerTier([
        curBase(),
        row(GROK_47, {
          assistantMessages: 60,
          findingsValidated: 36,
          findingsDismissed: 4, // taxa 0.9, n=40 → lo bem acima do hi do atual
          toolCalls: 100,
          toolErrors: 2, // tool MEDIDO e não pior
          latencyP50Ms: 800,
        }),
      ]),
      "max",
    );
    expect(d.verdict).toBe("switch");
    expect(d.challengerSlug).toBe(GROK_47);
    expect(d.comparison?.qualityCmp).toBe("cand_better");
    expect(d.comparison?.toolCmp).toBe("inconclusive"); // tool foi MEDIDO
  });

  it("troca por custo quando a qualidade empata mas é claramente mais barato", () => {
    const d = byTier(
      decidePerTier([
        row(CUR_MAX, {
          assistantMessages: 60,
          findingsValidated: 24,
          findingsDismissed: 16, // 0.6, n=40
          toolCalls: 100,
          toolErrors: 2,
          billedRequests: 100,
          billedCost: 200, // $2.00/req
        }),
        row(GROK_47, {
          assistantMessages: 60,
          findingsValidated: 24,
          findingsDismissed: 16, // mesma taxa → inconclusivo
          toolCalls: 100,
          toolErrors: 2,
          billedRequests: 100,
          billedCost: 100, // $1.00/req → 50% mais barato
        }),
      ]),
      "max",
    );
    expect(d.verdict).toBe("switch");
    expect(d.comparison?.costCmp).toBe("cand_cheaper");
    expect(d.comparison?.qualityCmp).toBe("inconclusive");
    expect(d.comparison?.toolCmp).toBe("inconclusive"); // tool MEDIDO no caminho de custo
  });

  it("mantém quando os IC se sobrepõem e não há ganho de custo", () => {
    const d = byTier(
      decidePerTier([
        curBase(),
        row(GROK_47, {
          assistantMessages: 60,
          findingsValidated: 24,
          findingsDismissed: 16, // 0.6 vs 0.5 → IC sobrepostos
          toolCalls: 100,
          toolErrors: 5,
          billedRequests: 50,
          billedCost: 50, // mesmo custo
          latencyP50Ms: 800,
        }),
      ]),
      "max",
    );
    expect(d.verdict).toBe("keep");
    expect(d.challengerSlug).toBe(GROK_47); // mostra a evidência do concorrente
    expect(d.comparison?.qualityCmp).toBe("inconclusive");
  });

  it("NÃO troca por preço quando o concorrente regride qualidade (veto)", () => {
    const d = byTier(
      decidePerTier([
        row(CUR_MAX, {
          assistantMessages: 60,
          findingsValidated: 36,
          findingsDismissed: 4, // 0.9
          toolCalls: 100,
          toolErrors: 2,
          billedRequests: 100,
          billedCost: 200, // $2.00/req
        }),
        row(GROK_47, {
          assistantMessages: 60,
          findingsValidated: 12,
          findingsDismissed: 28, // 0.3 → pior com IC separado
          toolCalls: 100,
          toolErrors: 2,
          billedRequests: 100,
          billedCost: 20, // muito mais barato, mas irrelevante
        }),
      ]),
      "max",
    );
    expect(d.verdict).toBe("keep");
    expect(d.comparison?.qualityCmp).toBe("cur_better");
  });
});

describe("decidePerTier — ausência de medição NUNCA vira troca", () => {
  it("qualidade NÃO medida em ambos (no_data) + mais barato → NÃO troca (insuficiente)", () => {
    const d = byTier(
      decidePerTier([
        row(CUR_MAX, {
          assistantMessages: 60,
          findingsValidated: 5,
          findingsDismissed: 3, // curados 8 < 10 → validationStat null
          toolCalls: 10, // < 30 → toolStat null
          billedRequests: 100,
          billedCost: 200,
        }),
        row(GROK_47, {
          assistantMessages: 60,
          findingsValidated: 4,
          findingsDismissed: 2, // curados 6 < 10 → null
          toolCalls: 5,
          billedRequests: 100,
          billedCost: 100, // mais barato, mas SEM sinal de qualidade
        }),
      ]),
      "max",
    );
    expect(d.verdict).not.toBe("switch");
    expect(d.verdict).toBe("insufficient");
    // atual está sem curadoria → a razão culpa o ATUAL, não os concorrentes
    expect(d.reason).toMatch(/atual/i);
    expect(d.comparison).toBeNull(); // qualidade não foi comparada → sem grade
  });

  it("qualidade melhor mas TOOL não medido → NÃO troca; insuficiente (tool não comprovado)", () => {
    const d = byTier(
      decidePerTier([
        curBase(), // tool medido (100 calls)
        row(GROK_47, {
          assistantMessages: 60,
          findingsValidated: 36,
          findingsDismissed: 4, // 0.9 → qualidade cand_better
          toolCalls: 12, // < 30 → toolStat null → toolCmp no_data
        }),
      ]),
      "max",
    );
    expect(d.verdict).toBe("insufficient"); // NÃO "keep" — tool não comprovado
    expect(d.challengerSlug).toBe(GROK_47);
    expect(d.reason).toMatch(/tool-sucesso não foi medido/i);
    expect(d.comparison?.qualityCmp).toBe("cand_better");
    expect(d.comparison?.toolCmp).toBe("no_data");
  });

  it("ganho por CUSTO mas TOOL não medido → NÃO troca (insuficiente)", () => {
    const d = byTier(
      decidePerTier([
        row(CUR_MAX, {
          assistantMessages: 60,
          findingsValidated: 24,
          findingsDismissed: 16, // n=40
          toolCalls: 100,
          toolErrors: 2,
          billedRequests: 100,
          billedCost: 200, // $2.00/req
        }),
        row(GROK_47, {
          assistantMessages: 60,
          findingsValidated: 24,
          findingsDismissed: 16, // inconclusivo
          toolCalls: 12, // < 30 → toolCmp no_data
          billedRequests: 100,
          billedCost: 100, // mais barato, mas tool não medido veta a troca
        }),
      ]),
      "max",
    );
    expect(d.verdict).not.toBe("switch");
    expect(d.verdict).toBe("insufficient");
    expect(d.comparison?.costCmp).toBe("cand_cheaper");
    expect(d.comparison?.toolCmp).toBe("no_data");
  });

  it("atual sem curadoria mas concorrente curado → insuficiente culpando o ATUAL", () => {
    const d = byTier(
      decidePerTier([
        row(CUR_MAX, {
          assistantMessages: 60,
          findingsValidated: 3,
          findingsDismissed: 2, // curados 5 < 10 → curV null
          toolCalls: 100,
          toolErrors: 2,
          billedRequests: 50,
          billedCost: 50,
        }),
        row(GROK_47, {
          assistantMessages: 60,
          findingsValidated: 40,
          findingsDismissed: 5, // curados 45 ≥ 10, mas curV null força no_data
          toolCalls: 100,
          toolErrors: 2,
          billedRequests: 50,
          billedCost: 40,
        }),
      ]),
      "max",
    );
    expect(d.verdict).toBe("insufficient");
    expect(d.reason).toMatch(/atual/i); // culpa o atual, não o concorrente curado
    expect(d.reason).not.toMatch(/desses modelos/i);
    expect(d.comparison).toBeNull(); // não insinua 89% vs — na grade
  });

  it("custo sobre poucas requisições (< MIN_REQUESTS) não conta → mantém", () => {
    const d = byTier(
      decidePerTier([
        row(CUR_MAX, {
          assistantMessages: 60,
          findingsValidated: 24,
          findingsDismissed: 16, // n=40
          toolCalls: 100,
          toolErrors: 2,
          billedRequests: 100,
          billedCost: 200, // $2.00/req
        }),
        row(GROK_47, {
          assistantMessages: 60,
          findingsValidated: 24,
          findingsDismissed: 16, // inconclusivo
          toolCalls: 100,
          toolErrors: 2,
          billedRequests: MIN_REQUESTS - 1, // amostra de custo insuficiente
          billedCost: 1, // pareceria $0.05/req, mas é descartado
        }),
      ]),
      "max",
    );
    expect(d.verdict).toBe("keep");
    expect(d.comparison?.costCmp).toBe("no_data");
  });

  it("leitura de qualidade indisponível → insuficiente 'indisponível', não '0 medido'", () => {
    const ds = decidePerTier([curBase()], { qualityUnavailable: true });
    for (const d of ds) {
      expect(d.verdict).toBe("insufficient");
      expect(d.reason).toMatch(/indispon[íi]vel/i);
      expect(d.reason).not.toMatch(/rode mais tasks/i);
    }
  });
});

describe("invariantes", () => {
  it("CURRENT_ASSIGNMENT ⊆ CANDIDATES (senão o atual nunca casa uma linha)", () => {
    const slugs = new Set(CANDIDATES.map((c) => c.slug));
    for (const s of Object.values(CURRENT_ASSIGNMENT)) {
      expect(slugs.has(s)).toBe(true);
    }
  });

  it("retorna standard/pro/max mesmo sem dados", () => {
    const ds = decidePerTier([row(CUR_STD, { assistantMessages: 1 })]);
    expect(ds.map((d) => d.tier).sort()).toEqual(["max", "pro", "standard"]);
    expect(ds.every((d) => d.verdict === "insufficient")).toBe(true);
  });
});
