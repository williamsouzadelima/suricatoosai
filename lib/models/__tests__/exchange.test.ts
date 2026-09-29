import {
  isEligible,
  blendedIndex,
  recommendPerTier,
  canonicalizeModelSlug,
  CURRENT_ASSIGNMENT,
  type MarketData,
  type OurUsage,
} from "../exchange";

function mkt(over: Partial<MarketData> & { slug: string }): MarketData {
  return {
    priceIn: 0.000001,
    priceOut: 0.000006,
    contextLength: 500000,
    uptime30m: 99.9,
    uptime1d: 99.5,
    latencyMs: null,
    throughput: null,
    providerCount: 1,
    supportsTools: true,
    createdIso: "2026-08-12",
    ...over,
  };
}

describe("isEligible", () => {
  it("rejeita ausência / sem preço de saída", () => {
    expect(isEligible(undefined)).toBe(false);
    expect(isEligible(mkt({ slug: "x", priceOut: null }))).toBe(false);
  });
  it("rejeita uptime abaixo do piso quando presente, mas aceita null", () => {
    expect(isEligible(mkt({ slug: "x", uptime30m: 90 }))).toBe(false);
    expect(isEligible(mkt({ slug: "x", uptime30m: null }))).toBe(true);
    expect(isEligible(mkt({ slug: "x", uptime30m: 95 }))).toBe(true);
  });
  it("exige tools quando o provedor declara não suportar; null passa", () => {
    expect(isEligible(mkt({ slug: "x", supportsTools: false }))).toBe(false);
    expect(isEligible(mkt({ slug: "x", supportsTools: null }))).toBe(true);
  });
  it("aceita o caso feliz", () => {
    expect(isEligible(mkt({ slug: "x" }))).toBe(true);
  });
});

describe("blendedIndex", () => {
  it("retorna null sem preço de saída", () => {
    expect(blendedIndex(mkt({ slug: "x", priceOut: null }))).toBeNull();
  });
  it("peso 0 = só custo; modelo mais barato pontua mais alto", () => {
    const grok46 = mkt({ slug: "a", priceIn: 0.000002, priceOut: 0.000006 });
    const grok47 = mkt({ slug: "b", priceIn: 0.0000016, priceOut: 0.0000048 });
    const i46 = blendedIndex(grok46, 0.5, 0)!;
    const i47 = blendedIndex(grok47, 0.5, 0)!;
    // effCost46 = (6e-6*3 + 2e-6)*1e6 = 20 -> costScore = 1-20/30 = 0.333 -> 33
    expect(i46).toBe(33);
    expect(i47).toBeGreaterThan(i46); // 4.7 é mais barato -> índice maior
  });
  it("peso 1 = só qualidade (neutra 0.5 -> 50)", () => {
    expect(blendedIndex(mkt({ slug: "x" }), 0.5, 1)).toBe(50);
    expect(blendedIndex(mkt({ slug: "x" }), 1, 1)).toBe(100);
  });
});

describe("canonicalizeModelSlug", () => {
  it("mantém slug de candidato exato", () => {
    expect(canonicalizeModelSlug("z-ai/glm-5.3")).toBe("z-ai/glm-5.3");
    expect(canonicalizeModelSlug("x-ai/grok-4.7")).toBe("x-ai/grok-4.7");
  });
  it("normaliza variante datada de candidato pelo strip -YYYYMMDD", () => {
    expect(canonicalizeModelSlug("x-ai/grok-4.7-20260916")).toBe(
      "x-ai/grok-4.7",
    );
    expect(canonicalizeModelSlug("deepseek/deepseek-v4.1-flash-20260910")).toBe(
      "deepseek/deepseek-v4.1-flash",
    );
  });
  it("evita a colisão -0813 (candidato) vs -20260813 (datado) via alias", () => {
    // O strip -YYYYMMDD daria "deepseek/deepseek-v4-pro" (OUTRO candidato);
    // o alias explícito garante o candidato certo (-0813).
    expect(canonicalizeModelSlug("deepseek/deepseek-v4-pro-20260813")).toBe(
      "deepseek/deepseek-v4-pro-0813",
    );
  });
  it("mapeia nomes internos model-* para o slug", () => {
    expect(canonicalizeModelSlug("model-grok-4.6")).toBe("x-ai/grok-4.6");
    expect(canonicalizeModelSlug("model-deepseek-v4.1-flash")).toBe(
      "deepseek/deepseek-v4.1-flash",
    );
    expect(canonicalizeModelSlug("agent-model-free")).toBe(
      "deepseek/deepseek-v4-flash-0731",
    );
  });
  it("devolve slug desconhecido inalterado", () => {
    expect(canonicalizeModelSlug("openai/gpt-5")).toBe("openai/gpt-5");
    expect(canonicalizeModelSlug("auto")).toBe("auto");
  });
});

describe("recommendPerTier", () => {
  it("recomenda o candidato elegível mais barato quando o peso é todo custo", () => {
    // Só grok-4.6 (atual do max) e grok-4.7 no mercado -> os demais são inelegíveis.
    const market = new Map<string, MarketData>([
      ["x-ai/grok-4.6", mkt({ slug: "x-ai/grok-4.6", priceOut: 0.000006 })],
      ["x-ai/grok-4.7", mkt({ slug: "x-ai/grok-4.7", priceOut: 0.0000048 })],
    ]);
    const recs = recommendPerTier(market, new Map(), new Map(), 0);
    const max = recs.find((r) => r.tier === "max")!;
    expect(max.currentSlug).toBe(CURRENT_ASSIGNMENT.max);
    expect(max.recommendedSlug).toBe("x-ai/grok-4.7");
  });

  it("não recomenda troca quando o atual já é o melhor elegível", () => {
    const market = new Map<string, MarketData>([
      ["x-ai/grok-4.6", mkt({ slug: "x-ai/grok-4.6" })],
    ]);
    const max = recommendPerTier(market, new Map(), new Map(), 0.5).find(
      (r) => r.tier === "max",
    )!;
    expect(max.recommendedSlug).toBeNull();
  });

  it("exclui candidatos inelegíveis (uptime baixo)", () => {
    const market = new Map<string, MarketData>([
      ["x-ai/grok-4.6", mkt({ slug: "x-ai/grok-4.6", priceOut: 0.000006 })],
      // 4.7 seria mais barato, mas está fora do ar -> não pode ser recomendado
      ["x-ai/grok-4.7", mkt({ slug: "x-ai/grok-4.7", priceOut: 0.0000048, uptime30m: 50 })],
    ]);
    const max = recommendPerTier(market, new Map(), new Map(), 0).find(
      (r) => r.tier === "max",
    )!;
    expect(max.recommendedSlug).toBeNull();
  });

  it("prefere o modelo ATUAL em empate de índice (peso 100% qualidade, v1 neutro)", () => {
    // Qualidade neutra p/ todos + weight=1 -> escores empatam. O atual (grok-4.6)
    // deve prevalecer sobre deepseek-v4-pro, que vem ANTES no array CANDIDATES.
    const market = new Map<string, MarketData>([
      ["x-ai/grok-4.6", mkt({ slug: "x-ai/grok-4.6", priceOut: 0.000006 })],
      ["deepseek/deepseek-v4-pro", mkt({ slug: "deepseek/deepseek-v4-pro", priceOut: 0.0000007 })],
      ["x-ai/grok-4.7", mkt({ slug: "x-ai/grok-4.7", priceOut: 0.0000048 })],
    ]);
    const max = recommendPerTier(market, new Map(), new Map(), 1).find(
      (r) => r.tier === "max",
    )!;
    expect(max.recommendedSlug).toBeNull(); // empate -> não sugere troca por posição
  });

  it("não sugere troca por diferença desprezível (dentro da margem)", () => {
    // Candidato marginalmente mais barato que o atual (abaixo da margem) -> mantém.
    const market = new Map<string, MarketData>([
      ["x-ai/grok-4.6", mkt({ slug: "x-ai/grok-4.6", priceOut: 0.000006 })],
      ["x-ai/grok-4.7", mkt({ slug: "x-ai/grok-4.7", priceOut: 0.0000059 })],
    ]);
    const max = recommendPerTier(market, new Map(), new Map(), 0).find(
      (r) => r.tier === "max",
    )!;
    expect(max.recommendedSlug).toBeNull();
  });

  it("recomenda o melhor elegível quando o ATUAL está inelegível (fora do ar)", () => {
    const market = new Map<string, MarketData>([
      ["x-ai/grok-4.6", mkt({ slug: "x-ai/grok-4.6", uptime30m: 40 })], // atual caído
      ["x-ai/grok-4.7", mkt({ slug: "x-ai/grok-4.7", priceOut: 0.0000048 })],
    ]);
    const max = recommendPerTier(market, new Map(), new Map(), 0.5).find(
      (r) => r.tier === "max",
    )!;
    expect(max.recommendedSlug).toBe("x-ai/grok-4.7");
  });

  it("calcula o custo do período a partir do nosso volume de saída", () => {
    const market = new Map<string, MarketData>([
      ["x-ai/grok-4.6", mkt({ slug: "x-ai/grok-4.6", priceOut: 0.000006 })],
    ]);
    const usage = new Map<string, OurUsage>([
      [
        "x-ai/grok-4.6",
        { slug: "x-ai/grok-4.6", requests: 10, costDollars: 5, outputTokens: 1_000_000 },
      ],
    ]);
    const max = recommendPerTier(market, usage, new Map(), 0.5).find(
      (r) => r.tier === "max",
    )!;
    // 1e6 tokens * 6e-6 $/tok = 6.0
    expect(max.periodCostNow).toBeCloseTo(6, 5);
  });
});
