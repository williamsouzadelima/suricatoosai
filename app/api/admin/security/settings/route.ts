import { NextRequest, NextResponse } from "next/server";
import { getSuperadminUser } from "@/lib/auth/require-superadmin";
import { getConvexClient } from "@/lib/db/convex-client";
import { api } from "@/convex/_generated/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  const settings = await getConvexClient().query(
    api.security.getSecuritySettingsForBackend,
    { serviceKey },
  );
  return NextResponse.json({ settings });
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
  const b = await req.json().catch(() => ({}));
  const num = (v: unknown, def: number) =>
    typeof v === "number" && Number.isFinite(v) ? v : def;
  const arr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  await getConvexClient().mutation(api.security.setSecuritySettingsForBackend, {
    serviceKey,
    enforcement_mode: b.enforcement_mode === "enforce" ? "enforce" : "shadow",
    auto_block_enabled: b.auto_block_enabled === true,
    auto_suspend_users: b.auto_suspend_users === true,
    kill_switch: b.kill_switch === true,
    req_burst_window_s: num(b.req_burst_window_s, 60),
    req_burst_max: num(b.req_burst_max, 600),
    deny_burst_max: num(b.deny_burst_max, 40),
    path_scan_distinct_max: num(b.path_scan_distinct_max, 25),
    auto_block_ttl_s: num(b.auto_block_ttl_s, 3600),
    safelist_ips: arr(b.safelist_ips),
    safelist_user_ids: arr(b.safelist_user_ids),
    updatedBy: admin.email ?? admin.id,
  });
  return NextResponse.json({ ok: true });
}
