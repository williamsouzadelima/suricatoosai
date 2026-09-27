import { NextResponse } from "next/server";
import { getSuperadminUser } from "@/lib/auth/require-superadmin";
import { getConvexClient } from "@/lib/db/convex-client";
import { api } from "@/convex/_generated/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// "Preso" = queued/rendering há mais de 10 min (mesmo espírito do watchdog do
// worker do trigger). nowMs vem daqui (Node), não da query Convex.
const STUCK_MS = 10 * 60 * 1000;

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
    api.reports.getSystemHealthForBackend,
    { serviceKey, nowMs: Date.now(), stuckMs: STUCK_MS },
  );

  return NextResponse.json(data);
}
