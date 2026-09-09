import { getConvexClient } from "@/lib/db/convex-client";
import { api } from "@/convex/_generated/api";
import { fireBudgetAlert } from "@/lib/monitoring/notify-budget";
import { ChatSDKError } from "@/lib/errors";

// NÃO importa "server-only": roda em Next (chat-handler / agent-trigger-route).

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
 * para BLOQUEAR o run (só quando o escopo tem block ligado E o custo REAL já
 * liquidado cruzou o teto). Roda no mesmo ponto que assertUserCanMakeCostIncurringRequest
 * (antes de qualquer dedução → sem refund).
 *
 * Segurança:
 * - Kill switch BUDGET_ENFORCEMENT_DISABLED e default DESLIGADO → no-op.
 * - FAIL-OPEN: erro/timeout de infra nas leituras NUNCA bloqueia (só loga).
 * - Anti-subcontagem: bloqueia só quando real >= cap; se a soma bateu o cap de
 *   leitura e ficou abaixo do teto, `real < cap` → não bloqueia (dado incompleto).
 * - Alertas são fire-and-forget (nunca afetam a decisão de bloqueio).
 *
 * Só a Camada A (gate). O teto por task mid-run (Camada B) é passo à parte.
 */
export async function enforceBudget(input: {
  userId: string;
  chatId?: string;
  userEmail?: string | null;
}): Promise<void> {
  if (process.env.BUDGET_ENFORCEMENT_DISABLED === "true") return;
  const serviceKey = process.env.CONVEX_SERVICE_ROLE_KEY;
  if (!serviceKey) return;

  let blockMessage: string | null = null;
  try {
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

    const perTaskCap = cfg.perTaskCapDollars;
    if (
      cfg.perTaskEnabled &&
      typeof perTaskCap === "number" &&
      perTaskCap > 0 &&
      input.chatId
    ) {
      const cap = perTaskCap;
      const level = levelFor(cost.taskReal, cap, warnFrac);
      if (level) {
        void fireBudgetAlert({
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
      if (cfg.perTaskBlock && cost.taskReal >= cap) {
        blockMessage = `Orçamento desta task foi excedido (US$ ${cost.taskReal.toFixed(
          4,
        )} de US$ ${cap.toFixed(4)}). Inicie uma nova task ou ajuste o teto em Configurações.`;
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
      if (cfg.perUserBlock && cost.userReal >= cap) {
        blockMessage = `Seu orçamento no período foi excedido (US$ ${cost.userReal.toFixed(
          4,
        )} de US$ ${cap.toFixed(4)}). Tente novamente após o reset ou ajuste o teto.`;
      }
    }
  } catch (e) {
    // FAIL-OPEN: falha de infra nunca interrompe engajamento legítimo.
    console.warn("[budget-guard] enforceBudget falhou (fail-open):", e);
    return;
  }

  if (blockMessage) {
    throw new ChatSDKError("forbidden:chat", blockMessage);
  }
}
