import { NextResponse } from "next/server";
import { getSuperadminUser } from "@/lib/auth/require-superadmin";
import { getConvexClient } from "@/lib/db/convex-client";
import { api } from "@/convex/_generated/api";

export const runtime = "nodejs";

function getServiceKey(): string | null {
  return process.env.CONVEX_SERVICE_ROLE_KEY ?? null;
}

const DAY = 86_400_000;

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

  const convex = getConvexClient();
  const [entries, activeAnnouncements, campaigns] = await Promise.all([
    convex.query(api.accessAllowlist.list, { serviceKey, limit: 2000 }),
    convex.query(api.announcements.getActive, {}),
    convex.query(api.emailMarketing.listCampaigns, { serviceKey, limit: 50 }),
  ]);

  const now = Date.now();
  const d7 = now - 7 * DAY;
  const d30 = now - 30 * DAY;

  const users = {
    total: entries.length,
    active: 0,
    invited: 0,
    revoked: 0,
    new7d: 0,
    new30d: 0,
  };
  for (const e of entries) {
    if (e.status === "active") users.active++;
    else if (e.status === "invited") users.invited++;
    else if (e.status === "revoked") users.revoked++;
    const joined = e.activated_at ?? e.invited_at;
    if (joined >= d7) users.new7d++;
    if (joined >= d30) users.new30d++;
  }

  let sent30d = 0;
  for (const c of campaigns) if (c.created_at >= d30) sent30d += c.sent;

  // Novos usuários por semana (janelas de 7 dias terminando agora), 10 semanas.
  const WEEK = 7 * DAY;
  const WEEKS = 10;
  const signupsByWeek: { start: number; count: number }[] = [];
  for (let i = WEEKS - 1; i >= 0; i--) {
    const end = now - i * WEEK;
    const start = end - WEEK;
    let count = 0;
    for (const e of entries) {
      const joined = e.activated_at ?? e.invited_at;
      if (joined >= start && joined < end) count++;
    }
    signupsByWeek.push({ start, count });
  }

  return NextResponse.json({
    users,
    announcementsActive: activeAnnouncements.length,
    campaigns: {
      count: campaigns.length,
      sent30d,
      recent: campaigns.slice(0, 5),
    },
    signupsByWeek,
    // Chegar aqui já implica Convex respondendo e site servindo.
    health: { convex: true, site: true },
  });
}
