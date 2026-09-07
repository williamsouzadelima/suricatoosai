import { NextRequest, NextResponse } from "next/server";
import { getSuperadminUser } from "@/lib/auth/require-superadmin";
import { getConvexClient } from "@/lib/db/convex-client";
import { api } from "@/convex/_generated/api";
import {
  sendBatch,
  unsubUrl,
  renderMarketingHtml,
  type BatchMessage,
} from "@/lib/marketing/send";

export const runtime = "nodejs";

const APP_BASE_URL =
  process.env.NEXT_PUBLIC_BASE_URL ?? "https://ai.suricatoos.com";
const FROM =
  process.env.MARKETING_EMAIL_FROM ?? "Suricatoos <noreply@suricatoos.com>";

function getServiceKey(): string | null {
  return process.env.CONVEX_SERVICE_ROLE_KEY ?? null;
}
const norm = (e: string) => e.trim().toLowerCase();

type Segment = "active" | "invited" | "all";
function normSegment(v: unknown): Segment {
  return v === "invited" || v === "all" ? v : "active";
}

async function recipientsFor(
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

function buildMessage(
  email: string,
  subject: string,
  body: string,
  secret: string,
): BatchMessage {
  const u = unsubUrl(APP_BASE_URL, email, secret);
  return {
    to: email,
    subject,
    html: renderMarketingHtml(body, u),
    text: `${body}\n\n---\nPara não receber mais estes e-mails: ${u}`,
    unsubscribeUrl: u,
  };
}

export async function GET() {
  const admin = await getSuperadminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const serviceKey = getServiceKey();
  if (!serviceKey) {
    return NextResponse.json(
      { error: "Server not configured (CONVEX_SERVICE_ROLE_KEY)" },
      { status: 500 },
    );
  }

  const [active, invited, all, campaigns] = await Promise.all([
    recipientsFor(serviceKey, "active"),
    recipientsFor(serviceKey, "invited"),
    recipientsFor(serviceKey, "all"),
    getConvexClient().query(api.emailMarketing.listCampaigns, {
      serviceKey,
      limit: 20,
    }),
  ]);

  return NextResponse.json({
    counts: { active: active.length, invited: invited.length, all: all.length },
    emailConfigured: Boolean(process.env.RESEND_API_KEY),
    adminEmail: admin.email ?? null,
    campaigns,
  });
}

export async function POST(req: NextRequest) {
  const admin = await getSuperadminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const serviceKey = getServiceKey();
  if (!serviceKey) {
    return NextResponse.json(
      { error: "Server not configured (CONVEX_SERVICE_ROLE_KEY)" },
      { status: 500 },
    );
  }
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "RESEND_API_KEY não configurada no servidor." },
      { status: 400 },
    );
  }

  let body: {
    action?: string;
    segment?: string;
    subject?: string;
    body?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const subject = (body.subject ?? "").trim();
  const text = (body.body ?? "").trim();
  if (!subject || !text) {
    return NextResponse.json(
      { error: "Assunto e mensagem são obrigatórios." },
      { status: 400 },
    );
  }

  if (body.action === "test") {
    const to = admin.email;
    if (!to) {
      return NextResponse.json(
        { error: "Sua conta não tem e-mail para o teste." },
        { status: 400 },
      );
    }
    const msg = buildMessage(to, `[teste] ${subject}`, text, serviceKey);
    const r = await sendBatch(apiKey, FROM, [msg]);
    if (r.failed > 0) {
      return NextResponse.json(
        { error: r.error ?? "Falha ao enviar teste." },
        { status: 502 },
      );
    }
    return NextResponse.json({ success: true, to });
  }

  if (body.action === "send") {
    const segment = normSegment(body.segment);
    const recipients = await recipientsFor(serviceKey, segment);
    if (recipients.length === 0) {
      return NextResponse.json(
        { error: "Nenhum destinatário no segmento (após descadastros)." },
        { status: 400 },
      );
    }
    const messages = recipients.map((e) =>
      buildMessage(e, subject, text, serviceKey),
    );
    const r = await sendBatch(apiKey, FROM, messages);
    await getConvexClient().mutation(api.emailMarketing.logCampaign, {
      serviceKey,
      subject,
      segment,
      total: recipients.length,
      sent: r.sent,
      failed: r.failed,
      createdBy: admin.email ?? admin.id,
    });
    return NextResponse.json({
      success: r.failed === 0,
      total: recipients.length,
      sent: r.sent,
      failed: r.failed,
      error: r.error,
    });
  }

  return NextResponse.json(
    { error: "Unknown action (test|send)" },
    { status: 400 },
  );
}
