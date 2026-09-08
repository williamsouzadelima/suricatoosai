import { NextRequest, NextResponse } from "next/server";
import { getSuperadminUser } from "@/lib/auth/require-superadmin";
import { getConvexClient } from "@/lib/db/convex-client";
import { api } from "@/convex/_generated/api";
import { sendTeamsAlert, sendEmailAlert } from "@/lib/monitoring/notify";
import { recordAudit } from "@/lib/admin/audit";

export const runtime = "nodejs";

function getServiceKey(): string | null {
  return process.env.CONVEX_SERVICE_ROLE_KEY ?? null;
}

function defaultFrom(): string {
  return process.env.ALERT_EMAIL_FROM ?? "Suricatoos Alertas <alertas@suricatoos.com>";
}

type Settings = {
  teams_enabled: boolean;
  teams_webhook_url?: string;
  email_enabled: boolean;
  email_to?: string;
};

function parseSettings(input: unknown): Settings | { error: string } {
  const s = (input ?? {}) as Record<string, unknown>;
  const teams_enabled = Boolean(s.teams_enabled);
  const email_enabled = Boolean(s.email_enabled);
  const teams_webhook_url =
    typeof s.teams_webhook_url === "string" ? s.teams_webhook_url.trim() : "";
  const email_to =
    typeof s.email_to === "string" ? s.email_to.trim().toLowerCase() : "";

  if (teams_enabled && !/^https:\/\/.+/i.test(teams_webhook_url)) {
    return { error: "Teams ligado exige uma URL de webhook https:// válida." };
  }
  if (email_enabled && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email_to)) {
    return { error: "E-mail ligado exige um endereço de destino válido." };
  }
  return {
    teams_enabled,
    teams_webhook_url: teams_webhook_url || undefined,
    email_enabled,
    email_to: email_to || undefined,
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

  const settings = await getConvexClient().query(api.monitorSettings.get, {
    serviceKey,
  });
  return NextResponse.json({
    settings,
    emailConfigured: Boolean(process.env.RESEND_API_KEY),
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

  let body: { action?: string; settings?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = parseSettings(body.settings);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  if (body.action === "save") {
    await getConvexClient().mutation(api.monitorSettings.update, {
      serviceKey,
      teams_enabled: parsed.teams_enabled,
      teams_webhook_url: parsed.teams_webhook_url,
      email_enabled: parsed.email_enabled,
      email_to: parsed.email_to,
      updatedBy: admin.email ?? admin.id,
    });
    await recordAudit(
      admin.email ?? admin.id,
      "alertas.salvar",
      undefined,
      [parsed.teams_enabled ? "teams" : "", parsed.email_enabled ? "email" : ""]
        .filter(Boolean)
        .join("+") || "nenhum canal",
    );
    return NextResponse.json({ success: true });
  }

  if (body.action === "test") {
    const subject = "🔧 Teste de alerta — Suricatoos";
    const text = `Se você recebeu isto, o canal está funcionando.\nEnviado por ${
      admin.email ?? admin.id
    } em ${new Date().toLocaleString("pt-BR")}.`;
    const results: Record<string, string> = {};

    if (parsed.teams_enabled && parsed.teams_webhook_url) {
      try {
        await sendTeamsAlert(parsed.teams_webhook_url, subject, text);
        results.teams = "ok";
      } catch (e) {
        results.teams = e instanceof Error ? e.message : "falhou";
      }
    }

    if (parsed.email_enabled && parsed.email_to) {
      const apiKey = process.env.RESEND_API_KEY;
      if (!apiKey) {
        results.email = "RESEND_API_KEY não configurada no servidor";
      } else {
        try {
          await sendEmailAlert({
            apiKey,
            from: defaultFrom(),
            to: parsed.email_to,
            subject,
            body: text,
          });
          results.email = "ok";
        } catch (e) {
          results.email = e instanceof Error ? e.message : "falhou";
        }
      }
    }

    if (Object.keys(results).length === 0) {
      return NextResponse.json(
        { error: "Nenhum canal habilitado para testar." },
        { status: 400 },
      );
    }
    return NextResponse.json({ success: true, results });
  }

  return NextResponse.json(
    { error: "Unknown action (expected 'save' or 'test')" },
    { status: 400 },
  );
}
