/**
 * Envio de alertas do monitor de saúde. Mesma lógica usada pelo botão "Enviar
 * teste" do /admin (server-side) e espelhada no monitor bash do Kali.
 * Sem dependências externas — HTTP direto (Teams webhook + Resend API).
 */

export async function sendTeamsAlert(
  webhookUrl: string,
  subject: string,
  body: string,
): Promise<void> {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // `text` funciona tanto no Incoming Webhook clássico quanto num fluxo
    // Workflows configurado para ler o campo text do corpo.
    body: JSON.stringify({ text: `**${subject}**\n\n${body}` }),
  });
  if (!res.ok) {
    throw new Error(`Teams webhook HTTP ${res.status}`);
  }
}

export async function sendEmailAlert(opts: {
  apiKey: string;
  from: string;
  to: string;
  subject: string;
  body: string;
}): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: opts.from,
      to: [opts.to],
      subject: opts.subject,
      text: opts.body,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Resend HTTP ${res.status} ${detail}`.trim());
  }
}
