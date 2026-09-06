import { NextRequest, NextResponse } from "next/server";
import { getSuperadminUser } from "@/lib/auth/require-superadmin";
import { getConvexClient } from "@/lib/db/convex-client";
import { api } from "@/convex/_generated/api";

export const runtime = "nodejs";

function getServiceKey(): string | null {
  return process.env.CONVEX_SERVICE_ROLE_KEY ?? null;
}

export async function GET(req: NextRequest) {
  const admin = await getSuperadminUser();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const serviceKey = getServiceKey();
  if (!serviceKey) {
    return NextResponse.json(
      { error: "Server not configured (CONVEX_SERVICE_ROLE_KEY)" },
      { status: 500 },
    );
  }

  const statusParam = req.nextUrl.searchParams.get("status");
  const status =
    statusParam === "invited" ||
    statusParam === "active" ||
    statusParam === "revoked"
      ? statusParam
      : undefined;

  const entries = await getConvexClient().query(api.accessAllowlist.list, {
    serviceKey,
    status,
    limit: 1000,
  });

  // Newest first by invite time.
  entries.sort((a, b) => b.invited_at - a.invited_at);

  return NextResponse.json({ entries });
}

export async function POST(req: NextRequest) {
  const admin = await getSuperadminUser();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const serviceKey = getServiceKey();
  if (!serviceKey) {
    return NextResponse.json(
      { error: "Server not configured (CONVEX_SERVICE_ROLE_KEY)" },
      { status: 500 },
    );
  }

  let body: { email?: string; action?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = (body.email ?? "").trim().toLowerCase();
  if (!email) {
    return NextResponse.json({ error: "Email required" }, { status: 400 });
  }

  if (body.action === "revoke") {
    await getConvexClient().mutation(api.accessAllowlist.revoke, {
      serviceKey,
      email,
    });
    return NextResponse.json({ success: true, email, status: "revoked" });
  }

  if (body.action === "reinvite") {
    const result = await getConvexClient().mutation(
      api.accessAllowlist.addInvite,
      { serviceKey, email, invitedBy: admin.email ?? admin.id },
    );
    return NextResponse.json({ success: true, email, status: result.status });
  }

  return NextResponse.json(
    { error: "Unknown action (expected 'revoke' or 'reinvite')" },
    { status: 400 },
  );
}
