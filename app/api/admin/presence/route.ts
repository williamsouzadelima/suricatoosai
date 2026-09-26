import { NextResponse } from "next/server";
import { getSuperadminUser } from "@/lib/auth/require-superadmin";
import { workos } from "@/app/api/workos";
import { getConvexClient } from "@/lib/db/convex-client";
import { api } from "@/convex/_generated/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// online = visto há < 2 min; idle = visto há < 12 min (senão nem aparece).
const ONLINE_MS = 2 * 60 * 1000;
const IDLE_MS = 12 * 60 * 1000;

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

  const data = await getConvexClient().query(
    api.presence.getPresenceForBackend,
    { serviceKey, nowMs: Date.now(), onlineMs: ONLINE_MS, idleMs: IDLE_MS },
  );

  // E-mails só dos usuários presentes (bounded pelo PRESENCE_CAP do backend).
  const emailById = new Map<string, string>();
  await Promise.all(
    data.users.map(async (u) => {
      try {
        const wu = await workos.userManagement.getUser(u.userId);
        if (wu?.email) emailById.set(u.userId, wu.email);
      } catch {
        // usuário some do WorkOS → cai no fallback do id
      }
    }),
  );
  const users = data.users.map((u) => ({
    ...u,
    email: emailById.get(u.userId) ?? u.userId,
  }));

  return NextResponse.json({ ...data, users });
}
