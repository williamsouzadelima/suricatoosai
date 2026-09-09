import { getConvexClient } from "@/lib/db/convex-client";
import { api } from "@/convex/_generated/api";
import { sendTeamsAlert, sendEmailAlert } from "@/lib/monitoring/notify";

// NÃO importa "server-only" nem budget-monitor.ts (que tem server-only): precisa
// rodar também no processo do Trigger na Fase 4b (mid-run). Autônomo sobre notify.ts.

function budgetEmailFrom(): string {
  return (
    process.env.ALERT_EMAIL_FROM ??
    "Suricatoos Alertas <alertas@suricatoos.com>"
  );
}

export interface BudgetAlertInput {
  scope: "task" | "user";
  scopeId: string;
  periodKey: string;
  threshold: "warn" | "block";
  alertTeams: boolean;
  alertEmail: boolean;
  userEmail?: string | null;
  costDollars: number;
  capDollars: number;
}

/**
 * Dispara alerta de orçamento (Teams/e-mail), fire-and-forget. NUNCA lança nem
 * bloqueia o run — o bloqueio é caminho totalmente separado. Dedup durável via
 * budgetAlerts.claimAlert: só o primeiro claim de um scope+período+threshold
 * envia (sobrevive a retries do Trigger e cruzamentos multi-run por usuário).
 */
export async function fireBudgetAlert(input: BudgetAlertInput): Promise<void> {
  try {
    const serviceKey = process.env.CONVEX_SERVICE_ROLE_KEY;
    if (!serviceKey) return;
    if (!input.alertTeams && !input.alertEmail) return;

    const convex = getConvexClient();

    const { claimed } = await convex.mutation(api.budgetAlerts.claimAlert, {
      serviceKey,
      scope: input.scope,
      scopeId: input.scopeId,
      periodKey: input.periodKey,
      threshold: input.threshold,
      costDollars: input.costDollars,
    });
    if (!claimed) return;

    const channels = await convex.query(api.monitorSettings.get, { serviceKey });

    const scopeLabel = input.scope === "task" ? "task" : "usuário";
    const verb =
      input.threshold === "block"
        ? "ATINGIU o teto"
        : "cruzou o limite de aviso";
    const subject = `Orçamento: ${scopeLabel} ${verb} (US$ ${input.costDollars.toFixed(
      4,
    )} de US$ ${input.capDollars.toFixed(4)})`;
    const body = [
      `Escopo: ${scopeLabel}`,
      `ID: ${input.scopeId}`,
      input.userEmail ? `Usuário: ${input.userEmail}` : "",
      `Período: ${input.periodKey}`,
      `Custo real: US$ ${input.costDollars.toFixed(6)}`,
      `Teto: US$ ${input.capDollars.toFixed(6)}`,
      `Nível: ${input.threshold}`,
    ]
      .filter(Boolean)
      .join("\n");

    // Reusa os DESTINOS configurados na aba Alertas (webhook Teams / e-mail).
    // Os toggles de orçamento (alertTeams/alertEmail) decidem PARA QUAL canal ir.
    if (input.alertTeams && channels.teams_webhook_url) {
      try {
        await sendTeamsAlert(channels.teams_webhook_url, subject, body);
      } catch (e) {
        console.warn("[budget-alert] Teams falhou:", e);
      }
    }
    if (input.alertEmail && channels.email_to) {
      const apiKey = process.env.RESEND_API_KEY;
      if (apiKey) {
        try {
          await sendEmailAlert({
            apiKey,
            from: budgetEmailFrom(),
            to: channels.email_to,
            subject,
            body,
          });
        } catch (e) {
          console.warn("[budget-alert] e-mail falhou:", e);
        }
      }
    }
  } catch (e) {
    console.warn("[budget-alert] fire falhou (não-fatal):", e);
  }
}
