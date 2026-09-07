import crypto from "node:crypto";

/**
 * Utilitários de e-mail marketing: token de descadastro (HMAC, sem tabela de
 * tokens), template HTML com rodapé de unsubscribe, e envio em lote via Resend.
 */

export function unsubToken(email: string, secret: string): string {
  return crypto
    .createHmac("sha256", secret)
    .update(email.trim().toLowerCase())
    .digest("hex")
    .slice(0, 32);
}

export function verifyUnsubToken(
  email: string,
  token: string,
  secret: string,
): boolean {
  const expected = unsubToken(email, secret);
  if (token.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
  } catch {
    return false;
  }
}

export function unsubUrl(
  baseUrl: string,
  email: string,
  secret: string,
): string {
  const t = unsubToken(email, secret);
  return `${baseUrl}/unsubscribe?e=${encodeURIComponent(email)}&t=${t}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderMarketingHtml(body: string, unsubscribeUrl: string): string {
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
    <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
    <p style="margin:0;font-size:12px;color:#9ca3af">
      Você recebe este e-mail por ser usuário do Suricatoos.
      <a href="${unsubscribeUrl}" style="color:#9ca3af;text-decoration:underline">Descadastrar</a>.
    </p>
  </div></body></html>`;
}

export interface BatchMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  unsubscribeUrl: string;
}

/**
 * Envia até 100 mensagens por chamada ao endpoint de batch do Resend.
 * Retorna quantas foram aceitas e quantas falharam.
 */
export async function sendBatch(
  apiKey: string,
  from: string,
  messages: BatchMessage[],
): Promise<{ sent: number; failed: number; error?: string }> {
  let sent = 0;
  let failed = 0;
  let error: string | undefined;

  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    const payload = chunk.map((m) => ({
      from,
      to: [m.to],
      subject: m.subject,
      html: m.html,
      text: m.text,
      headers: {
        "List-Unsubscribe": `<${m.unsubscribeUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    }));
    try {
      const res = await fetch("https://api.resend.com/emails/batch", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        sent += chunk.length;
      } else {
        failed += chunk.length;
        if (!error) error = `Resend HTTP ${res.status}`;
      }
    } catch (e) {
      failed += chunk.length;
      if (!error) error = e instanceof Error ? e.message : "erro de rede";
    }
  }

  return { sent, failed, error };
}
