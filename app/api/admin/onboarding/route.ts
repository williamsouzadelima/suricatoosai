import { NextRequest, NextResponse } from "next/server";
import { getSuperadminUser } from "@/lib/auth/require-superadmin";
import { getConvexClient } from "@/lib/db/convex-client";
import { api } from "@/convex/_generated/api";
import { sendWelcomeTo } from "@/lib/onboarding/welcome";

export const runtime = "nodejs";

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
  const settings = await getConvexClient().query(api.onboardingSettings.get, {
    serviceKey,
  });
  return NextResponse.json({
    settings,
    emailConfigured: Boolean(process.env.RESEND_API_KEY),
    adminEmail: admin.email ?? null,
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

  let body: {
    action?: string;
    enabled?: boolean;
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

  if (body.action === "save") {
    await getConvexClient().mutation(api.onboardingSettings.update, {
      serviceKey,
      enabled: Boolean(body.enabled),
      subject,
      body: text,
      updatedBy: admin.email ?? admin.id,
    });
    return NextResponse.json({ success: true });
  }

  if (body.action === "test") {
    const to = admin.email;
    if (!to) {
      return NextResponse.json(
        { error: "Sua conta não tem e-mail para o teste." },
        { status: 400 },
      );
    }
    try {
      await sendWelcomeTo(to, `[teste] ${subject}`, text);
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Falha ao enviar teste." },
        { status: 502 },
      );
    }
    return NextResponse.json({ success: true, to });
  }

  return NextResponse.json(
    { error: "Unknown action (save|test)" },
    { status: 400 },
  );
}
