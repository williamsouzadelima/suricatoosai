import { getConvexClient } from "@/lib/db/convex-client";
import { api } from "@/convex/_generated/api";
import { fireBudgetAlert } from "@/lib/monitoring/notify-budget";
import { ChatSDKError } from "@/lib/errors";

// NÃO importa "server-only": roda em Next (chat-handler / agent-trigger-route).

/**
 * Plano de orçamento para ESTE run, devolvido por enforceBudget (reusa suas
 * leituras). Alimenta a Camada B (corte mid-run por task) no agent-stream-runner.
 */
export interface BudgetRunPlan {
  /**
   * Orçamento REAL restante da task para este run (perTaskCap − custo real já
   * liquidado). Só é definido quando o bloqueio por task está LIGADO, cap>0 e a
   * task estava abaixo do teto no início. null = sem corte mid-run.
   */
  taskCapRemainingDollars: number | null;
  /** Dispara o alerta "task atingiu o teto mid-run" (dedup). No-op se sem plano. */
  fireTaskCapHitAlert: (realCostDollars: number) => void;
}

const NO_PLAN: BudgetRunPlan = {
  taskCapRemainingDollars: null,
  fireTaskCapHitAlert: () => {},
};

function periodRange(period: "day" | "month"): {
  startMs: number;
  endMs: number;
  key: string;
} {
  const now = new Date();
  const y = now.getUTCFullYear();
  const mo = now.getUTCMonth();
  const d = now.getUTCDate();
  const mm = String(mo + 1).padStart(2, "0");
  if (period === "day") {
    return {
      startMs: Date.UTC(y, mo, d),
      endMs: Date.now(),
      key: `${y}-${mm}-${String(d).padStart(2, "0")}`,
    };
  }
  return { startMs: Date.UTC(y, mo, 1), endMs: Date.now(), key: `${y}-${mm}` };
}

function levelFor(
  real: number,
  cap: number,
  warnFrac: number,
): "block" | "warn" | null {
  if (real >= cap) return "block";
  if (real >= cap * warnFrac) return "warn";
  return null;
}

/**
 * Fase 4 — gate de orçamento no início do run. AWAITED: pode LANÇAR ChatSDKError
 * para BLOQUEAR o run (só quando o escopo tem block ligado E o custo real já
 * liquidado cruzou o teto). Roda no mesmo ponto que assertUserCanMakeCostIncurringRequest
 * (antes de qualquer dedução → sem refund). Devolve um BudgetRunPlan para a Camada B.
 *
 * Segurança: kill switch BUDGET_ENFORCEMENT_DISABLED + default OFF → NO_PLAN.
 * FAIL-OPEN (erro de infra → NO_PLAN, nunca bloqueia). Anti-subcontagem (bloqueia só
 * quando real >= cap; capped-abaixo → real<cap → não bloqueia). cap>0 obrigatório.
 * Alertas são fire-and-forget (nunca afetam a decisão).
 */
export async function enforceBudget(input: {
  userId: string;
  chatId?: string;
  userEmail?: string | null;
  /**
   * true (padrão): LANÇA para bloquear no run-start quando já está acima do teto
   * (chat-handler interativo + gate de enqueue do agent-long). false: NÃO lança —
   * só devolve o plano (usado dentro do task do agent-long, que já foi gated no
   * enqueue; o corte é feito mid-run pela Camada B).
   */
  blockOnExceed?: boolean;
}): Promise<BudgetRunPlan> {
  const blockOnExceed = input.blockOnExceed ?? true;
  if (process.env.BUDGET_ENFORCEMENT_DISABLED === "true") return NO_PLAN;
  const serviceKey = process.env.CONVEX_SERVICE_ROLE_KEY;
  if (!serviceKey) return NO_PLAN;

  let blockMessage: string | null = null;
  let plan: BudgetRunPlan = NO_PLAN;
  try {
    const convex = getConvexClient();
    const cfg = await convex.query(api.budgetSettings.getEffectiveForUser, {
      serviceKey,
      userId: input.userId,
    });

    // Escopo POR ENGAJAMENTO — INDEPENDENTE do budgetSettings do usuário (é o
    // controle do analista sobre o engajamento). Só Camada A: recusa INICIAR
    // novos runs quando o gasto do engajamento já cruzou o teto; NUNCA corta run
    // em andamento (assimetria do per-user). getEngagementBudgetCheck só devolve
    // algo quando enforce está LIGADO e cap>0 (senão null → no-op).
    if (input.chatId) {
      const eng = await convex.query(api.usageLogs.getEngagementBudgetCheck, {
        serviceKey,
        chatId: input.chatId,
      });
      if (eng) {
        const engWarnFrac = Math.max(0, Math.min(1, eng.warnPct / 100));
        const engLevel = levelFor(eng.engReal, eng.capDollars, engWarnFrac);
        if (engLevel) {
          void fireBudgetAlert({
            scope: "engagement",
            scopeId: eng.engagementId,
            periodKey: "engagement",
            threshold: engLevel,
            alertTeams: cfg.alertTeams,
            alertEmail: cfg.alertEmail,
            userEmail: input.userEmail,
            costDollars: eng.engReal,
            capDollars: eng.capDollars,
          });
        }
        // Anti-subcontagem: só bloqueia quando a soma (lower-bound) já atinge o
        // teto. Se engCapped e a soma ficou abaixo, a incerteza deixa passar.
        // Lança direto (Camada A) — o catch de fail-open RE-LANÇA ChatSDKError.
        if (blockOnExceed && eng.engReal >= eng.capDollars) {
          throw new ChatSDKError(
            "forbidden:chat",
            `Este engajamento atingiu o teto de gasto de IA (US$ ${eng.engReal.toFixed(
              4,
            )} de US$ ${eng.capDollars.toFixed(
              4,
            )}). Ajuste o teto no engajamento para continuar.`,
          );
        }
      }
    }

    // budgetSettings (task/user) desligado → só o escopo de engajamento valia
    // (já lançou acima se bloqueou). Sem task/user, nada a cortar.
    if (!cfg.enabled || (!cfg.perTaskEnabled && !cfg.perUserEnabled)) {
      return NO_PLAN;
    }

    const range = periodRange(cfg.perUserPeriod);
    const cost = await convex.query(api.usageLogs.getRealCostForBudgetCheck, {
      serviceKey,
      chatId: input.chatId,
      userId: input.userId,
      periodStartMs: range.startMs,
      periodEndMs: range.endMs,
    });
    const warnFrac = Math.max(0, Math.min(1, cfg.warnThresholdPct / 100));

    const chatId = input.chatId;
    const perTaskCap = cfg.perTaskCapDollars;
    if (
      cfg.perTaskEnabled &&
      typeof perTaskCap === "number" &&
      perTaskCap > 0 &&
      chatId
    ) {
      const cap = perTaskCap;
      const level = levelFor(cost.taskReal, cap, warnFrac);
      if (level) {
        void fireBudgetAlert({
          scope: "task",
          scopeId: chatId,
          periodKey: "task",
          threshold: level,
          alertTeams: cfg.alertTeams,
          alertEmail: cfg.alertEmail,
          userEmail: input.userEmail,
          costDollars: cost.taskReal,
          capDollars: cap,
        });
      }
      if (cfg.perTaskBlock && blockOnExceed && cost.taskReal >= cap) {
        blockMessage = `Orçamento desta task foi excedido (US$ ${cost.taskReal.toFixed(
          4,
        )} de US$ ${cap.toFixed(4)}). Inicie uma nova task ou ajuste o teto em Configurações.`;
      } else if (cfg.perTaskBlock) {
        // Camada B: corte mid-run quando o custo real deste run cruzar o teto
        // restante. Se já está acima (blockOnExceed=false, ex.: task do agent-long),
        // remaining=0 → corta no primeiro step.
        plan = {
          taskCapRemainingDollars: Math.max(0, cap - cost.taskReal),
          fireTaskCapHitAlert: (realCostDollars: number) => {
            void fireBudgetAlert({
              scope: "task",
              scopeId: chatId,
              periodKey: "task",
              threshold: "block",
              alertTeams: cfg.alertTeams,
              alertEmail: cfg.alertEmail,
              userEmail: input.userEmail,
              costDollars: cost.taskReal + realCostDollars,
              capDollars: cap,
            });
          },
        };
      }
    }

    const perUserCap = cfg.perUserCapDollars;
    if (
      !blockMessage &&
      cfg.perUserEnabled &&
      typeof perUserCap === "number" &&
      perUserCap > 0
    ) {
      const cap = perUserCap;
      const level = levelFor(cost.userReal, cap, warnFrac);
      if (level) {
        void fireBudgetAlert({
          scope: "user",
          scopeId: input.userId,
          periodKey: range.key,
          threshold: level,
          alertTeams: cfg.alertTeams,
          alertEmail: cfg.alertEmail,
          userEmail: input.userEmail,
          costDollars: cost.userReal,
          capDollars: cap,
        });
      }
      // Teto por usuário NUNCA corta mid-run (assimetria de segurança): só recusa
      // iniciar novo run (por isso só bloqueia quando blockOnExceed).
      if (blockOnExceed && cfg.perUserBlock && cost.userReal >= cap) {
        blockMessage = `Seu orçamento no período foi excedido (US$ ${cost.userReal.toFixed(
          4,
        )} de US$ ${cap.toFixed(4)}). Tente novamente após o reset ou ajuste o teto.`;
      }
    }
  } catch (e) {
    // Bloqueio INTENCIONAL (ChatSDKError, ex.: teto de engajamento lançado
    // dentro do try) NÃO é falha de infra → re-lança.
    if (e instanceof ChatSDKError) throw e;
    // FAIL-OPEN: falha de infra nunca interrompe engajamento legítimo.
    console.warn("[budget-guard] enforceBudget falhou (fail-open):", e);
    return NO_PLAN;
  }

  if (blockMessage) {
    throw new ChatSDKError("forbidden:chat", blockMessage);
  }
  return plan;
}
