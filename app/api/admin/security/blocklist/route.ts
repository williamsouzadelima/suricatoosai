import { NextRequest, NextResponse } from "next/server";
import { getSuperadminUser } from "@/lib/auth/require-superadmin";
import { getConvexClient } from "@/lib/db/convex-client";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BlockType = "ip" | "cidr" | "user_agent" | "path_pattern";
const TYPES: BlockType[] = ["ip", "cidr", "user_agent", "path_pattern"];

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
  const items = await getConvexClient().query(
    api.security.listBlocklistForBackend,
    { serviceKey },
  );
  return NextResponse.json({ items });
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
  const body = await req.json().catch(() => ({}));
  const type = body.type as BlockType | undefined;
  const value = (body.value as string | undefined)?.trim();
  const reason = body.reason as string | undefined;
  const ttlSeconds =
    typeof body.ttlSeconds === "number" ? body.ttlSeconds : undefined;
  if (!type || !TYPES.includes(type) || !value) {
    return NextResponse.json(
      { error: "type e value válidos são obrigatórios." },
      { status: 400 },
    );
  }
  const convex = getConvexClient();
  const res = await convex.mutation(api.security.addBlockForBackend, {
    serviceKey,
    type,
    value,
    reason,
    source: "manual",
    ttlSeconds,
    createdBy: admin.email ?? admin.id,
  });
  try {
    await convex.mutation(api.securityAudit.recordSecurityEventForBackend, {
      serviceKey,
      eventType: type === "ip" || type === "cidr" ? "ip.blocked" : "ioc.added",
      actorUserId: admin.id,
      actorEmail: admin.email ?? undefined,
      actorKind: "internal",
      targetType: type,
      targetId: value,
      outcome: "success",
      detail: reason ? `bloqueio manual: ${reason}` : "bloqueio manual",
    });
  } catch (e) {
    console.error("security/blocklist: falha ao auditar bloqueio", e);
  }
  return NextResponse.json({ ok: true, ...res });
}

export async function DELETE(req: NextRequest) {
  const admin = await getSuperadminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const serviceKey = process.env.CONVEX_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return NextResponse.json(
      { error: "Server not configured" },
      { status: 500 },
    );
  }
  const body = await req.json().catch(() => ({}));
  const blockId = body.blockId as string | undefined;
  if (!blockId) {
    return NextResponse.json({ error: "blockId ausente" }, { status: 400 });
  }
  const convex = getConvexClient();
  const res = await convex.mutation(api.security.liftBlockForBackend, {
    serviceKey,
    blockId: blockId as Id<"security_blocklist">,
    liftedBy: admin.email ?? admin.id,
  });
  try {
    await convex.mutation(api.securityAudit.recordSecurityEventForBackend, {
      serviceKey,
      eventType:
        res.type === "ip" || res.type === "cidr"
          ? "ip.unblocked"
          : "ioc.removed",
      actorUserId: admin.id,
      actorEmail: admin.email ?? undefined,
      actorKind: "internal",
      targetType: res.type,
      targetId: res.value,
      outcome: "success",
      detail: "desbloqueio manual",
    });
  } catch (e) {
    console.error("security/blocklist: falha ao auditar desbloqueio", e);
  }
  return NextResponse.json({ ok: true });
}
