import { NextResponse } from "next/server";
import { getSuperadminUser } from "@/lib/auth/require-superadmin";
import { workos } from "@/app/api/workos";
import { getConvexClient } from "@/lib/db/convex-client";
import { api } from "@/convex/_generated/api";

export const runtime = "nodejs";

export async function GET() {
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

  // Enumerate all WorkOS users (paginated).
  type WorkosUser = {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    lastSignInAt?: string | null;
    createdAt?: string;
  };
  const users: WorkosUser[] = [];
  let after: string | undefined = undefined;
  let pages = 0;
  do {
    const res = await workos.userManagement.listUsers({
      limit: 100,
      ...(after ? { after } : {}),
    });
    for (const u of res.data) {
      users.push({
        id: u.id,
        email: u.email,
        firstName: u.firstName ?? null,
        lastName: u.lastName ?? null,
        lastSignInAt: (u as { lastSignInAt?: string | null }).lastSignInAt,
        createdAt: u.createdAt,
      });
    }
    after = res.listMetadata?.after ?? undefined;
    pages++;
  } while (after && pages < 200);

  const userIds = users.map((u) => u.id);
  const convex = getConvexClient();

  const [activity, suspendedIds, allowlist] = await Promise.all([
    convex.query(api.adminUsers.getUsersActivity, { serviceKey, userIds }),
    convex.query(api.userSuspensions.getAdminSuspendedStatus, {
      serviceKey,
      userIds,
    }),
    convex.query(api.accessAllowlist.list, { serviceKey, limit: 2000 }),
  ]);

  const activityById = new Map(activity.map((a) => [a.userId, a]));
  const suspendedSet = new Set(suspendedIds);
  const allowlistByEmail = new Map(
    allowlist.map((e) => [e.email.toLowerCase(), e.status]),
  );

  const rows = users.map((u) => {
    const a = activityById.get(u.id);
    return {
      id: u.id,
      email: u.email,
      name: [u.firstName, u.lastName].filter(Boolean).join(" ") || null,
      lastSignInAt: u.lastSignInAt ?? null,
      createdAt: u.createdAt ?? null,
      allowlistStatus: allowlistByEmail.get(u.email.toLowerCase()) ?? null,
      suspended: suspendedSet.has(u.id),
      requests: a?.requests ?? 0,
      inputTokens: a?.inputTokens ?? 0,
      outputTokens: a?.outputTokens ?? 0,
      costDollars: a?.costDollars ?? 0,
      lastActivityAt: a?.lastActivityAt ?? null,
      capped: a?.capped ?? false,
    };
  });

  // Most recently active first.
  rows.sort(
    (x, y) =>
      (y.lastActivityAt ?? 0) - (x.lastActivityAt ?? 0) ||
      x.email.localeCompare(y.email),
  );

  return NextResponse.json({ users: rows, total: rows.length });
}
