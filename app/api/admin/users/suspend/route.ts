import { NextRequest, NextResponse } from "next/server";
import { getSuperadminUser } from "@/lib/auth/require-superadmin";
import { getConvexClient } from "@/lib/db/convex-client";
import { api } from "@/convex/_generated/api";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const admin = await getSuperadminUser();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const serviceKey = process.env.CONVEX_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return NextResponse.json(
      { error: "Server not configured (CONVEX_SERVICE_ROLE_KEY)" },
      { status: 500 },
    );
  }

  let body: { userId?: string; action?: string; reason?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const userId = (body.userId ?? "").trim();
  if (!userId) {
    return NextResponse.json({ error: "userId required" }, { status: 400 });
  }

  const convex = getConvexClient();

  if (body.action === "suspend") {
    const res = await convex.mutation(api.userSuspensions.adminSuspend, {
      serviceKey,
      userId,
      reason: body.reason?.trim() || undefined,
      adminEmail: admin.email ?? admin.id,
    });
    return NextResponse.json({ success: true, suspended: res.suspended });
  }

  if (body.action === "unsuspend") {
    const res = await convex.mutation(api.userSuspensions.adminUnsuspend, {
      serviceKey,
      userId,
      reason: body.reason?.trim() || undefined,
    });
    return NextResponse.json({ success: true, resolved: res.resolved });
  }

  return NextResponse.json(
    { error: "Unknown action (expected 'suspend' or 'unsuspend')" },
    { status: 400 },
  );
}
