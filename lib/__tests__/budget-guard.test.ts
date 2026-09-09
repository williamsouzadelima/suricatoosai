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

describe("enforceBudget (Fase 4b — gate)", () => {
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

  it("no-op quando o controle está desligado (não lê custo)", async () => {
    mockQuery.mockResolvedValueOnce({ ...CFG, enabled: false });
    await expect(enforceBudget({ userId: "u1", chatId: "c1" })).resolves.toBeUndefined();
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("BLOQUEIA quando block por-task ligado e custo real >= teto", async () => {
    mockQuery.mockResolvedValueOnce(CFG).mockResolvedValueOnce(cost({ taskReal: 6 }));
    await expect(enforceBudget({ userId: "u1", chatId: "c1" })).rejects.toBeInstanceOf(ChatSDKError);
  });

  it("NÃO bloqueia abaixo do teto", async () => {
    mockQuery.mockResolvedValueOnce(CFG).mockResolvedValueOnce(cost({ taskReal: 2 }));
    await expect(enforceBudget({ userId: "u1", chatId: "c1" })).resolves.toBeUndefined();
  });

  it("NÃO bloqueia em modo alerta-only (block flag off) mesmo acima do teto", async () => {
    mockQuery
      .mockResolvedValueOnce({ ...CFG, perTaskBlock: false })
      .mockResolvedValueOnce(cost({ taskReal: 99 }));
    await expect(enforceBudget({ userId: "u1", chatId: "c1" })).resolves.toBeUndefined();
  });

  it("NÃO bloqueia sobre soma capada abaixo do teto (anti-subcontagem)", async () => {
    mockQuery
      .mockResolvedValueOnce(CFG)
      .mockResolvedValueOnce(cost({ taskReal: 3, taskCapped: true }));
    await expect(enforceBudget({ userId: "u1", chatId: "c1" })).resolves.toBeUndefined();
  });

  it("NÃO bloqueia com cap negativo/inválido (guarda contra wrong-block)", async () => {
    mockQuery
      .mockResolvedValueOnce({ ...CFG, perTaskCapDollars: -1 })
      .mockResolvedValueOnce(cost({ taskReal: 0 }));
    await expect(enforceBudget({ userId: "u1", chatId: "c1" })).resolves.toBeUndefined();
  });

  it("FAIL-OPEN: erro de infra na leitura não bloqueia", async () => {
    mockQuery.mockRejectedValueOnce(new Error("convex down"));
    await expect(enforceBudget({ userId: "u1", chatId: "c1" })).resolves.toBeUndefined();
  });

  it("kill switch BUDGET_ENFORCEMENT_DISABLED desliga tudo (nem lê)", async () => {
    process.env.BUDGET_ENFORCEMENT_DISABLED = "true";
    await expect(enforceBudget({ userId: "u1", chatId: "c1" })).resolves.toBeUndefined();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("BLOQUEIA por teto de usuário quando acima", async () => {
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
