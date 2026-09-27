import { NextRequest, NextResponse } from "next/server";
import { getSuperadminUser } from "@/lib/auth/require-superadmin";
import { workos } from "@/app/api/workos";
import { getConvexClient } from "@/lib/db/convex-client";
import { api } from "@/convex/_generated/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Runs de agente em execução agora (usuários com presença recente) + kill switch.
const WINDOW_MS = 30 * 60 * 1000;

export async function GET() {
  const admin = await getSuperadminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const serviceKey = process.env.CONVEX_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return NextResponse.json(
      { error: "Server not configured" },
      { status: 500 },
    );
  }
  const data = await getConvexClient().query(
    api.liveOps.getLiveRunsForBackend,
    {
      serviceKey,
      nowMs: Date.now(),
      windowMs: WINDOW_MS,
    },
  );
  const emailById = new Map<string, string>();
  const uniqueIds = [...new Set(data.runs.map((r) => r.userId))];
  await Promise.all(
    uniqueIds.map(async (id) => {
      try {
        const wu = await workos.userManagement.getUser(id);
        if (wu?.email) emailById.set(id, wu.email);
      } catch {
        // sem e-mail → cai no id
      }
    }),
  );
  const runs = data.runs.map((r) => ({
    ...r,
    email: emailById.get(r.userId) ?? r.userId,
  }));
  return NextResponse.json({ runs, scannedUsers: data.scannedUsers });
}

export async function POST(req: NextRequest) {
  const admin = await getSuperadminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const serviceKey = process.env.CONVEX_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return NextResponse.json(
      { error: "Server not configured" },
      { status: 500 },
    );
  }
  const body = await req.json().catch(() => ({}));
  const chatId = body.chatId as string | undefined;
  if (!chatId) {
    return NextResponse.json({ error: "chatId ausente" }, { status: 400 });
  }
  const res = await getConvexClient().mutation(
    api.liveOps.adminCancelRunForBackend,
    { serviceKey, chatId },
  );
  console.log(`live-runs: ${admin.email} abortou run do chat ${chatId}`, res);
  return NextResponse.json(res);
}
