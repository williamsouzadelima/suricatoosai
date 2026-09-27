import { NextRequest, NextResponse } from "next/server";
import { getSuperadminUser } from "@/lib/auth/require-superadmin";
import { workos } from "@/app/api/workos";
import { getConvexClient } from "@/lib/db/convex-client";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PERIODS = ["1h", "24h", "7d", "30d", "90d", "180d", "365d"] as const;
type Period = (typeof PERIODS)[number];

// Análise de custos por período (e opcionalmente por cliente) para o /admin.
// Agregação vem do Convex (usage_logs); aqui só resolvemos e-mails dos usuários
// que apareceram na janela (top-N), para o ranking de atividade.
export async function GET(req: NextRequest) {
  const admin = await getSuperadminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const serviceKey = process.env.CONVEX_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return NextResponse.json(
      { error: "Server not configured (CONVEX_SERVICE_ROLE_KEY)" },
      { status: 500 },
    );
  }

  const url = new URL(req.url);
  const periodParam = url.searchParams.get("period");
  const period: Period = PERIODS.includes(periodParam as Period)
    ? (periodParam as Period)
    : "30d";
  const clientIdParam = url.searchParams.get("clientId");
  const clientId =
    clientIdParam && clientIdParam !== "all"
      ? (clientIdParam as Id<"clients">)
      : undefined;

  const data = await getConvexClient().query(
    api.adminUsers.getCostAnalyticsForBackend,
    {
      serviceKey,
      period,
      ...(clientId ? { clientId } : {}),
      nowMs: Date.now(),
    },
  );

  // E-mails só dos usuários da janela (bounded pelo TOP_USERS do backend).
  const emailById = new Map<string, string>();
  await Promise.all(
    data.byUser.map(async (u) => {
      try {
        const wu = await workos.userManagement.getUser(u.userId);
        if (wu?.email) emailById.set(u.userId, wu.email);
      } catch {
        // usuário some do WorkOS → cai no fallback do id
      }
    }),
  );
  const byUser = data.byUser.map((u) => ({
    ...u,
    email: emailById.get(u.userId) ?? u.userId,
  }));

  return NextResponse.json({ ...data, byUser });
}
