import { NextResponse } from "next/server";
import { getSuperadminUser } from "@/lib/auth/require-superadmin";
import { workos } from "@/app/api/workos";
import { getConvexClient } from "@/lib/db/convex-client";
import { api } from "@/convex/_generated/api";

export const runtime = "nodejs";

// Per-task (per-chat) cost list for the /admin panel. Enumerates WorkOS users
// for the userIds + an id->email map, then aggregates usage_logs per chat_id.
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

  const emailById = new Map<string, string>();
  const userIds: string[] = [];
  let after: string | undefined = undefined;
  let pages = 0;
  do {
    const res = await workos.userManagement.listUsers({
      limit: 100,
      ...(after ? { after } : {}),
    });
    for (const u of res.data) {
      userIds.push(u.id);
      emailById.set(u.id, u.email);
    }
    after = res.listMetadata?.after ?? undefined;
    pages++;
  } while (after && pages < 200);

  const tasks = await getConvexClient().query(api.adminUsers.getTaskCosts, {
    serviceKey,
    userIds,
  });

  const items = tasks.map((t) => ({
    ...t,
    userEmail: emailById.get(t.userId) ?? t.userId,
  }));

  return NextResponse.json({ items });
}
