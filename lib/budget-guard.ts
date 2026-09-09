import { getConvexClient } from "@/lib/db/convex-client";
import { api } from "@/convex/_generated/api";
import { fireBudgetAlert } from "@/lib/monitoring/notify-budget";

// NÃO importa "server-only": roda em Next e (na 4b) no Trigger.

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

/**
 * Fase 4a — gate de orçamento em modo ALERTA-ONLY. Fire-and-forget: NUNCA lança
 * nem adiciona latência ao início do run (chame com `void`). Lê a config efetiva
 * do usuário; se ligada, soma o custo REAL (provider_billed) da task/usuário e
 * dispara alertas (warn / atingiu-teto) com dedup durável. O BLOQUEIO (throw +
 * estorno) é a Fase 4b — este helper nunca interrompe o run.
 */
export async function checkBudgetAndAlert(input: {
  userId: string;
  chatId?: string;
  userEmail?: string | null;
}): Promise<void> {
  try {
    if (process.env.BUDGET_ENFORCEMENT_DISABLED === "true") return;
    const serviceKey = process.env.CONVEX_SERVICE_ROLE_KEY;
    if (!serviceKey) return;
    const convex = getConvexClient();

    const cfg = await convex.query(api.budgetSettings.getEffectiveForUser, {
      serviceKey,
      userId: input.userId,
    });
    if (!cfg.enabled) return;
    if (!cfg.perTaskEnabled && !cfg.perUserEnabled) return;

    const range = periodRange(cfg.perUserPeriod);
    const cost = await convex.query(api.usageLogs.getRealCostForBudgetCheck, {
      serviceKey,
      chatId: input.chatId,
      userId: input.userId,
      periodStartMs: range.startMs,
      periodEndMs: range.endMs,
    });

    const warnFrac = Math.max(0, Math.min(1, cfg.warnThresholdPct / 100));

    const levelFor = (real: number, cap: number): "block" | "warn" | null =>
      real >= cap ? "block" : real >= cap * warnFrac ? "warn" : null;

    if (cfg.perTaskEnabled && cfg.perTaskCapDollars && input.chatId) {
      const cap = cfg.perTaskCapDollars;
      const level = levelFor(cost.taskReal, cap);
      if (level) {
        await fireBudgetAlert({
          scope: "task",
          scopeId: input.chatId,
          periodKey: "task",
          threshold: level,
          alertTeams: cfg.alertTeams,
          alertEmail: cfg.alertEmail,
          userEmail: input.userEmail,
          costDollars: cost.taskReal,
          capDollars: cap,
        });
      }
    }

    if (cfg.perUserEnabled && cfg.perUserCapDollars) {
      const cap = cfg.perUserCapDollars;
      const level = levelFor(cost.userReal, cap);
      if (level) {
        await fireBudgetAlert({
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
    }
  } catch (e) {
    console.warn("[budget-guard] checkBudgetAndAlert falhou (não-fatal):", e);
  }
}
