import { NextRequest, NextResponse } from "next/server";
import { getSuperadminUser } from "@/lib/auth/require-superadmin";
import { getConvexClient } from "@/lib/db/convex-client";
import { api } from "@/convex/_generated/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Trilha imutável de segurança (report/evidence/membership/access.denied…).
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

  const eventType = new URL(req.url).searchParams.get("eventType") ?? undefined;
  const data = await getConvexClient().query(
    api.securityAudit.getSecurityAuditForBackend,
    { serviceKey, ...(eventType ? { eventType } : {}), limit: 200 },
  );

  return NextResponse.json(data);
}
