import { NextRequest, NextResponse } from "next/server";
import { getSuperadminUser } from "@/lib/auth/require-superadmin";
import { workos } from "@/app/api/workos";
import { getConvexClient } from "@/lib/db/convex-client";
import { api } from "@/convex/_generated/api";

export const runtime = "nodejs";

// Cost breakdown for a single task (chat): totals + per-model + per-run.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ chatId: string }> },
) {
  const admin = await getSuperadminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const serviceKey = process.env.CONVEX_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return NextResponse.json(
      { error: "Server not configured (CONVEX_SERVICE_ROLE_KEY)" },
      { status: 500 },
    );
  }

  const { chatId } = await params;
  const detail = await getConvexClient().query(
    api.adminUsers.getTaskCostDetail,
    { serviceKey, chatId },
  );

  let userEmail: string | null = null;
  if (detail.userId) {
    try {
      const u = await workos.userManagement.getUser(detail.userId);
      userEmail = u.email;
    } catch {
      userEmail = detail.userId;
    }
  }

  return NextResponse.json({ detail: { ...detail, userEmail } });
}
