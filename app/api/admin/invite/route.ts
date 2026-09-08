import { NextRequest, NextResponse } from "next/server";
import { getSuperadminUser } from "@/lib/auth/require-superadmin";
import { workos } from "@/app/api/workos";
import { getConvexClient } from "@/lib/db/convex-client";
import { api } from "@/convex/_generated/api";
import { recordAudit } from "@/lib/admin/audit";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const admin = await getSuperadminUser();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { email?: string; note?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = (body.email ?? "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Valid email required" }, { status: 400 });
  }

  const serviceKey = process.env.CONVEX_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return NextResponse.json(
      { error: "Server not configured (CONVEX_SERVICE_ROLE_KEY)" },
      { status: 500 },
    );
  }

  // 1) Allowlist entry is the source of truth for invite-only access.
  const result = await getConvexClient().mutation(
    api.accessAllowlist.addInvite,
    {
      serviceKey,
      email,
      invitedBy: admin.email ?? admin.id,
      note: body.note?.trim() || undefined,
    },
  );

  // 2) Best-effort WorkOS invitation email (signup link). Not required for the
  // allowlist to work — if it fails, the entry still grants access on signup.
  let invitationSent = false;
  try {
    await workos.userManagement.sendInvitation({
      email,
      inviterUserId: admin.id,
    });
    invitationSent = true;
  } catch (error) {
    console.warn(
      "[admin/invite] sendInvitation failed (allowlist entry still created)",
      error instanceof Error ? error.message : String(error),
    );
  }

  await recordAudit(
    admin.email ?? admin.id,
    "convite.enviar",
    email,
    result.created ? "novo" : "reenvio",
  );

  return NextResponse.json({
    success: true,
    email,
    status: result.status,
    created: result.created,
    invitationSent,
  });
}
