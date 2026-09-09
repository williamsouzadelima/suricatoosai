import { ChatSDKError } from "@/lib/errors";

const mockQuery = jest.fn();

jest.mock("@/lib/db/convex-client", () => ({
  getConvexClient: () => ({ query: mockQuery, mutation: jest.fn() }),
}));
jest.mock("@/lib/monitoring/notify-budget", () => ({
  fireBudgetAlert: jest.fn().mockResolvedValue(undefined),
}));

import { enforceBudget } from "@/lib/budget-guard";

const CFG = {
  enabled: true,
  perTaskEnabled: true,
  perTaskCapDollars: 5,
  perTaskBlock: true,
  perUserEnabled: false,
  perUserCapDollars: null as number | null,
  perUserPeriod: "month" as const,
  perUserBlock: false,
  warnThresholdPct: 80,
  alertTeams: false,
  alertEmail: false,
};

const cost = (o: Partial<{ taskReal: number; userReal: number; taskCapped: boolean; userCapped: boolean }>) => ({
  taskReal: 0,
  userReal: 0,
  taskCapped: false,
  userCapped: false,
  ...o,
});

describe("enforceBudget (Fase 4b — gate + plano Camada B)", () => {
  const OLD = process.env.CONVEX_SERVICE_ROLE_KEY;
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CONVEX_SERVICE_ROLE_KEY = "svc-test";
    delete process.env.BUDGET_ENFORCEMENT_DISABLED;
  });
  afterAll(() => {
    if (OLD === undefined) delete process.env.CONVEX_SERVICE_ROLE_KEY;
    else process.env.CONVEX_SERVICE_ROLE_KEY = OLD;
  });

  it("no-op (NO_PLAN) quando o controle está desligado (não lê custo)", async () => {
    mockQuery.mockResolvedValueOnce({ ...CFG, enabled: false });
    const plan = await enforceBudget({ userId: "u1", chatId: "c1" });
    expect(plan.taskCapRemainingDollars).toBeNull();
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("BLOQUEIA (throw) quando block por-task ligado e custo real >= teto", async () => {
    mockQuery.mockResolvedValueOnce(CFG).mockResolvedValueOnce(cost({ taskReal: 6 }));
    await expect(enforceBudget({ userId: "u1", chatId: "c1" })).rejects.toBeInstanceOf(ChatSDKError);
  });

  it("NÃO bloqueia abaixo do teto e devolve o teto restante da task (Camada B)", async () => {
    mockQuery.mockResolvedValueOnce(CFG).mockResolvedValueOnce(cost({ taskReal: 2 }));
    const plan = await enforceBudget({ userId: "u1", chatId: "c1" });
    expect(plan.taskCapRemainingDollars).toBe(3); // 5 - 2
  });

  it("alerta-only (block off): não bloqueia e SEM plano de corte mid-run", async () => {
    mockQuery
      .mockResolvedValueOnce({ ...CFG, perTaskBlock: false })
      .mockResolvedValueOnce(cost({ taskReal: 99 }));
    const plan = await enforceBudget({ userId: "u1", chatId: "c1" });
    expect(plan.taskCapRemainingDollars).toBeNull();
  });

  it("NÃO bloqueia sobre soma capada abaixo do teto (anti-subcontagem); plano usa o parcial", async () => {
    mockQuery
      .mockResolvedValueOnce(CFG)
      .mockResolvedValueOnce(cost({ taskReal: 3, taskCapped: true }));
    const plan = await enforceBudget({ userId: "u1", chatId: "c1" });
    expect(plan.taskCapRemainingDollars).toBe(2); // 5 - 3
  });

  it("NÃO bloqueia com cap negativo/inválido (guarda contra wrong-block)", async () => {
    mockQuery
      .mockResolvedValueOnce({ ...CFG, perTaskCapDollars: -1 })
      .mockResolvedValueOnce(cost({ taskReal: 0 }));
    const plan = await enforceBudget({ userId: "u1", chatId: "c1" });
    expect(plan.taskCapRemainingDollars).toBeNull();
  });

  it("FAIL-OPEN: erro de infra na leitura → NO_PLAN, não bloqueia", async () => {
    mockQuery.mockRejectedValueOnce(new Error("convex down"));
    const plan = await enforceBudget({ userId: "u1", chatId: "c1" });
    expect(plan.taskCapRemainingDollars).toBeNull();
  });

  it("kill switch BUDGET_ENFORCEMENT_DISABLED desliga tudo (nem lê)", async () => {
    process.env.BUDGET_ENFORCEMENT_DISABLED = "true";
    const plan = await enforceBudget({ userId: "u1", chatId: "c1" });
    expect(plan.taskCapRemainingDollars).toBeNull();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("BLOQUEIA por teto de usuário quando acima (usuário nunca gera plano mid-run)", async () => {
    mockQuery
      .mockResolvedValueOnce({
        ...CFG,
        perTaskEnabled: false,
        perTaskCapDollars: null,
        perTaskBlock: false,
        perUserEnabled: true,
        perUserCapDollars: 50,
        perUserBlock: true,
      })
      .mockResolvedValueOnce(cost({ userReal: 60 }));
    await expect(enforceBudget({ userId: "u1", chatId: "c1" })).rejects.toBeInstanceOf(ChatSDKError);
  });
});
