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
const DISABLED = { ...CFG, enabled: false };

const cost = (
  o: Partial<{
    taskReal: number;
    userReal: number;
    taskCapped: boolean;
    userCapped: boolean;
  }>,
) => ({ taskReal: 0, userReal: 0, taskCapped: false, userCapped: false, ...o });

type Eng = {
  engagementId: string;
  capDollars: number;
  warnPct: number;
  engReal: number;
  engCapped: boolean;
} | null;

// As queries em enforceBudget rodam NESTA ordem (com chatId): getEffectiveForUser
// (cfg) → getEngagementBudgetCheck (eng) → [getRealCostForBudgetCheck (cost), só
// quando o budgetSettings de task/user está ligado]. O helper encadeia nessa ordem.
function mockRun(opts: {
  cfg: typeof CFG;
  eng?: Eng;
  cost?: ReturnType<typeof cost>;
}) {
  mockQuery.mockResolvedValueOnce(opts.cfg); // 1: cfg
  mockQuery.mockResolvedValueOnce(opts.eng ?? null); // 2: eng
  if (opts.cost !== undefined) mockQuery.mockResolvedValueOnce(opts.cost); // 3: cost
}

const ENG = (engReal: number, over: Partial<Eng> = {}): Eng => ({
  engagementId: "e1",
  capDollars: 10,
  warnPct: 80,
  engReal,
  engCapped: false,
  ...(over as object),
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

  it("no-op (NO_PLAN) quando o controle está desligado e sem teto de engajamento (não lê custo)", async () => {
    mockRun({ cfg: DISABLED, eng: null });
    const plan = await enforceBudget({ userId: "u1", chatId: "c1" });
    expect(plan.taskCapRemainingDollars).toBeNull();
    // lê cfg + eng, mas NÃO o custo de task/user.
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it("BLOQUEIA (throw) quando block por-task ligado e custo real >= teto", async () => {
    mockRun({ cfg: CFG, eng: null, cost: cost({ taskReal: 6 }) });
    await expect(
      enforceBudget({ userId: "u1", chatId: "c1" }),
    ).rejects.toBeInstanceOf(ChatSDKError);
  });

  it("NÃO bloqueia abaixo do teto e devolve o teto restante da task (Camada B)", async () => {
    mockRun({ cfg: CFG, eng: null, cost: cost({ taskReal: 2 }) });
    const plan = await enforceBudget({ userId: "u1", chatId: "c1" });
    expect(plan.taskCapRemainingDollars).toBe(3); // 5 - 2
  });

  it("alerta-only (block off): não bloqueia e SEM plano de corte mid-run", async () => {
    mockRun({
      cfg: { ...CFG, perTaskBlock: false },
      eng: null,
      cost: cost({ taskReal: 99 }),
    });
    const plan = await enforceBudget({ userId: "u1", chatId: "c1" });
    expect(plan.taskCapRemainingDollars).toBeNull();
  });

  it("NÃO bloqueia sobre soma capada abaixo do teto (anti-subcontagem); plano usa o parcial", async () => {
    mockRun({
      cfg: CFG,
      eng: null,
      cost: cost({ taskReal: 3, taskCapped: true }),
    });
    const plan = await enforceBudget({ userId: "u1", chatId: "c1" });
    expect(plan.taskCapRemainingDollars).toBe(2); // 5 - 3
  });

  it("NÃO bloqueia com cap negativo/inválido (guarda contra wrong-block)", async () => {
    mockRun({
      cfg: { ...CFG, perTaskCapDollars: -1 },
      eng: null,
      cost: cost({ taskReal: 0 }),
    });
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
    mockRun({
      cfg: {
        ...CFG,
        perTaskEnabled: false,
        perTaskCapDollars: null,
        perTaskBlock: false,
        perUserEnabled: true,
        perUserCapDollars: 50,
        perUserBlock: true,
      },
      eng: null,
      cost: cost({ userReal: 60 }),
    });
    await expect(
      enforceBudget({ userId: "u1", chatId: "c1" }),
    ).rejects.toBeInstanceOf(ChatSDKError);
  });

  // ── Escopo POR ENGAJAMENTO ────────────────────────────────────────────────
  it("BLOQUEIA por teto de ENGAJAMENTO mesmo com budgetSettings desligado (independência)", async () => {
    mockRun({ cfg: DISABLED, eng: ENG(12) }); // 12 >= 10
    await expect(
      enforceBudget({ userId: "u1", chatId: "c1" }),
    ).rejects.toBeInstanceOf(ChatSDKError);
    // nunca chega a ler o custo de task/user (early-return após o bloqueio).
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it("engajamento NÃO bloqueia abaixo do teto (task Camada B segue valendo)", async () => {
    mockRun({ cfg: CFG, eng: ENG(3), cost: cost({ taskReal: 2 }) });
    const plan = await enforceBudget({ userId: "u1", chatId: "c1" });
    expect(plan.taskCapRemainingDollars).toBe(3);
  });

  it("engajamento: soma capada abaixo do teto NÃO bloqueia (anti-subcontagem)", async () => {
    mockRun({ cfg: DISABLED, eng: ENG(8, { engCapped: true }) }); // 8 < 10
    const plan = await enforceBudget({ userId: "u1", chatId: "c1" });
    expect(plan.taskCapRemainingDollars).toBeNull();
  });

  it("engajamento: blockOnExceed=false NÃO bloqueia mesmo acima (task do agent-long)", async () => {
    mockRun({ cfg: DISABLED, eng: ENG(50) });
    const plan = await enforceBudget({
      userId: "u1",
      chatId: "c1",
      blockOnExceed: false,
    });
    expect(plan.taskCapRemainingDollars).toBeNull();
  });
});
