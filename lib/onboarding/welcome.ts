import { getConvexClient } from "@/lib/db/convex-client";
import { api } from "@/convex/_generated/api";

/**
 * E-mail de boas-vindas transacional, disparado uma vez no primeiro acesso do
 * convidado (quando a allowlist promove invited -> active). Best-effort: nunca
 * quebra o login. Ligado/editado no /admin (aba Marketing).
 */

const FROM =
  process.env.MARKETING_EMAIL_FROM ?? "Suricatoos <noreply@suricatoos.com>";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderWelcomeHtml(body: string): string {
  const paragraphs = body
    .split(/\n{2,}/)
    .map(
      (p) =>
        `<p style="margin:0 0 16px;line-height:1.6;color:#1f2937">${escapeHtml(
          p,
        ).replace(/\n/g, "<br/>")}</p>`,
    )
    .join("");
  return `<!doctype html><html><body style="margin:0;background:#f5f5f5;padding:24px;font-family:-apple-system,Segoe UI,Roboto,sans-serif">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:28px;border:1px solid #eee">
    <div style="font-weight:700;font-size:18px;color:#0a0a0a;margin-bottom:16px">Suricatoos</div>
    ${paragraphs}
  </div></body></html>`;
}

/** Envia diretamente (usado pelo boas-vindas automático e pelo teste do /admin). */
export async function sendWelcomeTo(
  to: string,
  subject: string,
  body: string,
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY não configurada no servidor.");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM,
      to: [to],
      subject,
      html: renderWelcomeHtml(body),
      text: body,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Resend HTTP ${res.status} ${detail}`.trim());
  }
}

/** Envia o boas-vindas se estiver habilitado no /admin. Retorna se enviou. */
export async function sendWelcomeEmail(email: string): Promise<boolean> {
  const serviceKey = process.env.CONVEX_SERVICE_ROLE_KEY;
  const apiKey = process.env.RESEND_API_KEY;
  if (!serviceKey || !apiKey || !email) return false;
  try {
    const s = await getConvexClient().query(api.onboardingSettings.get, {
      serviceKey,
    });
    if (!s.enabled) return false;
    await sendWelcomeTo(email, s.subject, s.body);
    return true;
  } catch (error) {
    console.warn(
      "[welcome] falha ao enviar (não-fatal)",
      error instanceof Error ? error.message : String(error),
    );
    return false;
  }
}
