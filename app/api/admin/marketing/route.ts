import { NextRequest, NextResponse } from "next/server";
import { getSuperadminUser } from "@/lib/auth/require-superadmin";
import { getConvexClient } from "@/lib/db/convex-client";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { sendBatch, unsubUrl, renderMarketingHtml } from "@/lib/marketing/send";
import {
  recipientsFor,
  sendCampaign,
  normSegment,
} from "@/lib/marketing/dispatch";

export const runtime = "nodejs";

const APP_BASE_URL =
  process.env.NEXT_PUBLIC_BASE_URL ?? "https://ai.suricatoos.com";
const FROM =
  process.env.MARKETING_EMAIL_FROM ?? "Suricatoos <noreply@suricatoos.com>";

function getServiceKey(): string | null {
  return process.env.CONVEX_SERVICE_ROLE_KEY ?? null;
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

  const [active, invited, all, campaigns, scheduled] = await Promise.all([
    recipientsFor(serviceKey, "active"),
    recipientsFor(serviceKey, "invited"),
    recipientsFor(serviceKey, "all"),
    getConvexClient().query(api.emailMarketing.listCampaigns, {
      serviceKey,
      limit: 20,
    }),
    getConvexClient().query(api.scheduledCampaigns.listAll, {
      serviceKey,
      limit: 50,
    }),
  ]);

  return NextResponse.json({
    counts: { active: active.length, invited: invited.length, all: all.length },
    emailConfigured: Boolean(process.env.RESEND_API_KEY),
    adminEmail: admin.email ?? null,
    campaigns,
    scheduled,
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
    scheduledAt?: number;
    id?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Cancelar um agendamento não exige assunto/corpo.
  if (body.action === "cancel") {
    if (!body.id)
      return NextResponse.json({ error: "id required" }, { status: 400 });
    await getConvexClient().mutation(api.scheduledCampaigns.cancel, {
      serviceKey,
      id: body.id as Id<"scheduled_campaigns">,
    });
    return NextResponse.json({ success: true });
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
    const u = unsubUrl(APP_BASE_URL, to, serviceKey);
    const r = await sendBatch(apiKey, FROM, [
      {
        to,
        subject: `[teste] ${subject}`,
        html: renderMarketingHtml(text, u),
        text: `${text}\n\n---\nDescadastrar: ${u}`,
        unsubscribeUrl: u,
      },
    ]);
    if (r.failed > 0) {
      return NextResponse.json(
        { error: r.error ?? "Falha ao enviar teste." },
        { status: 502 },
      );
    }
    return NextResponse.json({ success: true, to });
  }

  if (body.action === "schedule") {
    const when = body.scheduledAt;
    if (typeof when !== "number" || !Number.isFinite(when)) {
      return NextResponse.json(
        { error: "Data/hora inválida." },
        { status: 400 },
      );
    }
    if (when < Date.now() - 60_000) {
      return NextResponse.json(
        { error: "A data/hora precisa estar no futuro." },
        { status: 400 },
      );
    }
    await getConvexClient().mutation(api.scheduledCampaigns.schedule, {
      serviceKey,
      subject,
      body: text,
      segment: normSegment(body.segment),
      scheduledAt: when,
      createdBy: admin.email ?? admin.id,
    });
    return NextResponse.json({ success: true });
  }

  if (body.action === "send") {
    const r = await sendCampaign(serviceKey, apiKey, {
      segment: normSegment(body.segment),
      subject,
      body: text,
      createdBy: admin.email ?? admin.id,
    });
    if (r.total === 0) {
      return NextResponse.json(
        { error: "Nenhum destinatário no segmento (após descadastros)." },
        { status: 400 },
      );
    }
    return NextResponse.json({
      success: r.failed === 0,
      total: r.total,
      sent: r.sent,
      failed: r.failed,
      error: r.error,
    });
  }

  return NextResponse.json(
    { error: "Unknown action (test|send|schedule|cancel)" },
    { status: 400 },
  );
}
