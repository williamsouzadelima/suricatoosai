import { getConvexClient } from "@/lib/db/convex-client";
import { api } from "@/convex/_generated/api";
import { sendBatch, unsubUrl, renderMarketingHtml } from "@/lib/marketing/send";

/**
 * Lógica compartilhada de envio de campanha (usada pela rota /admin/marketing
 * e pelo dispatcher de campanhas agendadas). Monta destinatários por segmento
 * (menos descadastros), envia em lote via Resend e registra no log.
 */

const APP_BASE_URL =
  process.env.NEXT_PUBLIC_BASE_URL ?? "https://ai.suricatoos.com";
const FROM =
  process.env.MARKETING_EMAIL_FROM ?? "Suricatoos <noreply@suricatoos.com>";

const norm = (e: string) => e.trim().toLowerCase();

export type Segment = "active" | "invited" | "all";
export function normSegment(v: unknown): Segment {
  return v === "invited" || v === "all" ? v : "active";
}

export async function recipientsFor(
  serviceKey: string,
  segment: Segment,
): Promise<string[]> {
  const convex = getConvexClient();
  const optOuts = new Set(
    (
      await convex.query(api.emailMarketing.getOptOutEmails, { serviceKey })
    ).map(norm),
  );
  const emails: string[] = [];
  if (segment === "active" || segment === "all") {
    const rows = await convex.query(api.accessAllowlist.list, {
      serviceKey,
      status: "active",
      limit: 2000,
    });
    emails.push(...rows.map((r) => r.email));
  }
  if (segment === "invited" || segment === "all") {
    const rows = await convex.query(api.accessAllowlist.list, {
      serviceKey,
      status: "invited",
      limit: 2000,
    });
    emails.push(...rows.map((r) => r.email));
  }
  return Array.from(new Set(emails.map(norm))).filter(
    (e) => e && e.includes("@") && !optOuts.has(e),
  );
}

export interface SendResult {
  total: number;
  sent: number;
  failed: number;
  error?: string;
}

/** Envia uma campanha para um segmento e registra no log de campanhas. */
export async function sendCampaign(
  serviceKey: string,
  apiKey: string,
  opts: { segment: Segment; subject: string; body: string; createdBy?: string },
): Promise<SendResult> {
  const recipients = await recipientsFor(serviceKey, opts.segment);
  if (recipients.length === 0) {
    return { total: 0, sent: 0, failed: 0, error: "sem destinatários" };
  }
  const messages = recipients.map((email) => {
    const u = unsubUrl(APP_BASE_URL, email, serviceKey);
    return {
      to: email,
      subject: opts.subject,
      html: renderMarketingHtml(opts.body, u),
      text: `${opts.body}\n\n---\nPara não receber mais estes e-mails: ${u}`,
      unsubscribeUrl: u,
    };
  });
  const r = await sendBatch(apiKey, FROM, messages);
  await getConvexClient().mutation(api.emailMarketing.logCampaign, {
    serviceKey,
    subject: opts.subject,
    segment: opts.segment,
    total: recipients.length,
    sent: r.sent,
    failed: r.failed,
    createdBy: opts.createdBy,
  });
  return { total: recipients.length, sent: r.sent, failed: r.failed, error: r.error };
}
