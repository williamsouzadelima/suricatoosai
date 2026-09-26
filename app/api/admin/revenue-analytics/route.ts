import { NextRequest, NextResponse } from "next/server";
import { getSuperadminUser } from "@/lib/auth/require-superadmin";
import { getConvexClient } from "@/lib/db/convex-client";
import { api } from "@/convex/_generated/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PERIODS = ["7d", "30d", "90d", "180d", "365d"] as const;
type Period = (typeof PERIODS)[number];

// Visão de negócio (receita/custo/lucro) por período, do rollup diário
// unit_economics_daily. Company-wide (não tem recorte por cliente).
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

  const periodParam = new URL(req.url).searchParams.get("period");
  const period: Period = PERIODS.includes(periodParam as Period)
    ? (periodParam as Period)
    : "30d";

  const data = await getConvexClient().query(
    api.adminUsers.getRevenueAnalyticsForBackend,
    { serviceKey, period, nowMs: Date.now() },
  );

  return NextResponse.json(data);
}
