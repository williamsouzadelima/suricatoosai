import { pickActiveKey, type PoolKeyLite } from "./llmKeySelect";

function k(over: Partial<PoolKeyLite> & { _id: string }): PoolKeyLite {
  return {
    provider: "openrouter",
    enabled: true,
    priority: 100,
    status: "active",
    created_at: 1,
    ...over,
  };
}

describe("pickActiveKey", () => {
  it("menor prioridade primeiro", () => {
    const chosen = pickActiveKey([
      k({ _id: "a", priority: 100 }),
      k({ _id: "b", priority: 10 }),
      k({ _id: "c", priority: 50 }),
    ]);
    expect(chosen?._id).toBe("b");
  });

  it("empate de prioridade → mais antiga", () => {
    const chosen = pickActiveKey([
      k({ _id: "new", priority: 10, created_at: 200 }),
      k({ _id: "old", priority: 10, created_at: 100 }),
    ]);
    expect(chosen?._id).toBe("old");
  });

  it("pula desabilitada, esgotada e com erro", () => {
    const chosen = pickActiveKey([
      k({ _id: "disabled", priority: 1, enabled: false }),
      k({ _id: "exhausted", priority: 2, status: "exhausted" }),
      k({ _id: "error", priority: 3, status: "error" }),
      k({ _id: "ok", priority: 4, status: "untested" }),
    ]);
    expect(chosen?._id).toBe("ok");
  });

  it("excludeIds pula a chave que já falhou nesta rodada", () => {
    const chosen = pickActiveKey(
      [k({ _id: "a", priority: 1 }), k({ _id: "b", priority: 2 })],
      { excludeIds: ["a"] },
    );
    expect(chosen?._id).toBe("b");
  });

  it("isola por provider: nunca devolve chave de outro provider (mesmo com prioridade menor)", () => {
    const keys = [
      k({ _id: "or1", provider: "openrouter", priority: 1 }),
      k({ _id: "uno1", provider: "unorouter", priority: 100 }),
    ];
    expect(pickActiveKey(keys, { provider: "unorouter" })?._id).toBe("uno1");
    expect(pickActiveKey(keys, { provider: "openrouter" })?._id).toBe("or1");
  });

  it("provider sem chave usável → null (não cai em outro provider)", () => {
    const keys = [k({ _id: "or1", provider: "openrouter", priority: 1 })];
    expect(pickActiveKey(keys, { provider: "unorouter" })).toBeNull();
  });

  it("sem provider = qualquer provider (back-compat)", () => {
    const keys = [k({ _id: "or1", provider: "openrouter", priority: 1 })];
    expect(pickActiveKey(keys)?._id).toBe("or1");
  });

  it("null quando não há usável", () => {
    expect(
      pickActiveKey([
        k({ _id: "x", enabled: false }),
        k({ _id: "y", status: "exhausted" }),
      ]),
    ).toBeNull();
    expect(pickActiveKey([])).toBeNull();
  });
});
