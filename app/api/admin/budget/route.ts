import { NextRequest, NextResponse } from "next/server";
import { getSuperadminUser } from "@/lib/auth/require-superadmin";
import { getConvexClient } from "@/lib/db/convex-client";
import { api } from "@/convex/_generated/api";
import { recordAudit } from "@/lib/admin/audit";

export const runtime = "nodejs";

function toNum(v: unknown): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

// Cap conservador: >0 ou vazio (desligado); teto de sanidade contra typo.
function validCap(v: unknown): number | undefined {
  const n = toNum(v);
  if (n === undefined) return undefined;
  if (n <= 0) throw new Error("Teto deve ser maior que 0 (ou vazio para desligar).");
  if (n > 1000)
    throw new Error("Teto acima de US$ 1000 — revise (proteção contra erro de digitação).");
  return n;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

export async function GET() {
  const admin = await getSuperadminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const serviceKey = process.env.CONVEX_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return NextResponse.json(
      { error: "Server not configured (CONVEX_SERVICE_ROLE_KEY)" },
      { status: 500 },
    );
  }
  const convex = getConvexClient();
  const [settings, overrides, channels] = await Promise.all([
    convex.query(api.budgetSettings.get, { serviceKey }),
    convex.query(api.budgetSettings.listOverrides, { serviceKey }),
    convex.query(api.monitorSettings.get, { serviceKey }),
  ]);
  return NextResponse.json({
    settings,
    overrides,
    emailConfigured: !!process.env.RESEND_API_KEY && !!channels.email_to,
    teamsConfigured: !!channels.teams_webhook_url,
  });
}

export async function POST(req: NextRequest) {
  const admin = await getSuperadminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const serviceKey = process.env.CONVEX_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return NextResponse.json({ error: "Server not configured" }, { status: 500 });
  }
  const convex = getConvexClient();
  const actor = admin.email ?? admin.id;

  const body = (await req.json().catch(() => null)) as {
    action?: string;
    settings?: Record<string, unknown>;
    override?: Record<string, unknown>;
    userId?: string;
  } | null;
  if (!body) return NextResponse.json({ error: "JSON inválido" }, { status: 400 });

  try {
    if (body.action === "save") {
      const s = body.settings ?? {};
      const warn = toNum(s.warn_threshold_pct);
      if (warn !== undefined && (warn < 1 || warn > 100)) {
        throw new Error("Limite de aviso deve ser entre 1 e 100%.");
      }
      await convex.mutation(api.budgetSettings.update, {
        serviceKey,
        enabled: !!s.enabled,
        per_task_enabled: !!s.per_task_enabled,
        per_task_cap_dollars: validCap(s.per_task_cap_dollars),
        per_task_block: !!s.per_task_block,
        per_user_enabled: !!s.per_user_enabled,
        per_user_cap_dollars: validCap(s.per_user_cap_dollars),
        per_user_period: s.per_user_period === "day" ? "day" : "month",
        per_user_block: !!s.per_user_block,
        warn_threshold_pct: warn ?? 80,
        alert_teams: !!s.alert_teams,
        alert_email: !!s.alert_email,
        updatedBy: actor,
      });
      await recordAudit(
        actor,
        "orcamento.salvar",
        undefined,
        `enabled=${!!s.enabled} taskBlock=${!!s.per_task_block} userBlock=${!!s.per_user_block}`,
      );
      return NextResponse.json({ success: true });
    }

    if (body.action === "set-override") {
      const o = body.override ?? {};
      const userId = str(o.userId);
      if (!userId) {
        return NextResponse.json({ error: "userId obrigatório" }, { status: 400 });
      }
      await convex.mutation(api.budgetSettings.upsertUserOverride, {
        serviceKey,
        userId,
        email: str(o.email),
        perTaskCapDollars: validCap(o.perTaskCapDollars),
        perUserCapDollars: validCap(o.perUserCapDollars),
        disabled: !!o.disabled,
        note: str(o.note),
        updatedBy: actor,
      });
      await recordAudit(
        actor,
        "orcamento.override",
        str(o.email) ?? userId,
        o.disabled ? "isento" : "cap custom",
      );
      return NextResponse.json({ success: true });
    }

    if (body.action === "remove-override") {
      const userId = str(body.userId);
      if (!userId) {
        return NextResponse.json({ error: "userId obrigatório" }, { status: 400 });
      }
      await convex.mutation(api.budgetSettings.removeUserOverride, {
        serviceKey,
        userId,
      });
      await recordAudit(actor, "orcamento.override", userId, "removido");
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "ação desconhecida" }, { status: 400 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "erro ao salvar" },
      { status: 400 },
    );
  }
}
