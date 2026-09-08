import { NextResponse } from "next/server";
import { getSuperadminUser } from "@/lib/auth/require-superadmin";
import { workos } from "@/app/api/workos";
import { getConvexClient } from "@/lib/db/convex-client";
import { api } from "@/convex/_generated/api";
import { recordAudit } from "@/lib/admin/audit";

export const runtime = "nodejs";

/**
 * Grandfather all existing WorkOS users into the access allowlist as "active".
 * Idempotent (existing entries are skipped). Run once before enabling
 * INVITE_ONLY_ENABLED so no current user loses access.
 */
export async function POST() {
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
  const emails: string[] = [];
  let after: string | undefined = undefined;
  let pages = 0;
  const MAX_PAGES = 200; // safety cap (200 * 100 = 20k users)
  do {
    const res = await workos.userManagement.listUsers({
      limit: 100,
      ...(after ? { after } : {}),
    });
    for (const u of res.data) {
      if (u.email) emails.push(u.email);
    }
    after = res.listMetadata?.after ?? undefined;
    pages++;
  } while (after && pages < MAX_PAGES);

  // Bulk grandfather as active (idempotent in Convex).
  const result = await getConvexClient().mutation(
    api.accessAllowlist.backfillActive,
    { serviceKey, emails, invitedBy: "backfill" },
  );

  await recordAudit(
    admin.email ?? admin.id,
    "grandfather",
    undefined,
    `${result.inserted} adicionados, ${result.skipped} já existiam (${emails.length} no WorkOS)`,
  );

  return NextResponse.json({
    success: true,
    totalWorkosUsers: emails.length,
    inserted: result.inserted,
    skipped: result.skipped,
    pages,
  });
}
