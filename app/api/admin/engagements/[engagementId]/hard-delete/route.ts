import { NextRequest, NextResponse } from "next/server";
import { ConvexError } from "convex/values";
import { getSuperadminUser } from "@/lib/auth/require-superadmin";
import { getConvexClient } from "@/lib/db/convex-client";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Exclusão DEFINITIVA (irreversível) de um engajamento. SÓ superadmin
 * (getSuperadminUser → 403). A cascata roda no Convex
 * (hardDeleteEngagementForBackend), batcheada; esta rota:
 *  - dryRun=true  → preview das contagens SEM apagar nada;
 *  - senão        → repete a mutação enquanto hasMore (até MAX_BATCHES).
 * A auditoria (pre/post) é DURÁVEL dentro da própria mutação. As pré-condições
 * (run ativo / relatório em geração / recorrência despachando) voltam como 409.
 */
const MAX_BATCHES = 60;

type Agg = {
  deleted: Record<string, number>;
  detached: number;
  s3ObjectsQueued: number;
};

function mergeDeleted(agg: Agg, deleted: Record<string, number>) {
  for (const [k, n] of Object.entries(deleted)) {
    agg.deleted[k] = (agg.deleted[k] ?? 0) + n;
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ engagementId: string }> },
) {
  const admin = await getSuperadminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const serviceKey = process.env.CONVEX_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return NextResponse.json(
      { error: "Server not configured" },
      { status: 500 },
    );
  }
  const { engagementId: raw } = await params;
  const engagementId = raw as Id<"engagements">;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const dryRun =
    body?.dryRun === true ||
    new URL(req.url).searchParams.get("dryRun") === "1";

  const convex = getConvexClient();
  const owner = await convex.query(
    api.engagements.getEngagementOwnerForBackend,
    { serviceKey, engagementId },
  );
  if (!owner) {
    return NextResponse.json(
      { error: "Engajamento não encontrado" },
      { status: 404 },
    );
  }

  try {
    if (dryRun) {
      const r = await convex.mutation(
        api.engagements.hardDeleteEngagementForBackend,
        {
          serviceKey,
          engagementId,
          expectedOwnerUserId: owner.userId,
          actorUserId: admin.id,
          dryRun: true,
        },
      );
      return NextResponse.json({
        dryRun: true,
        name: owner.name,
        deleted: r.deleted,
        detached: r.detached,
        s3ObjectsQueued: r.s3ObjectsQueued,
        partial: r.hasMore,
      });
    }

    const agg: Agg = { deleted: {}, detached: 0, s3ObjectsQueued: 0 };
    let done = false;
    for (let i = 0; i < MAX_BATCHES; i++) {
      const r = await convex.mutation(
        api.engagements.hardDeleteEngagementForBackend,
        {
          serviceKey,
          engagementId,
          expectedOwnerUserId: owner.userId,
          actorUserId: admin.id,
        },
      );
      mergeDeleted(agg, r.deleted);
      agg.detached += r.detached;
      agg.s3ObjectsQueued += r.s3ObjectsQueued;
      if (!r.hasMore) {
        done = true;
        break;
      }
    }
    return NextResponse.json({ done, name: owner.name, ...agg });
  } catch (err) {
    if (err instanceof ConvexError) {
      const data = err.data as { code?: string; message?: string } | undefined;
      const code = data?.code ?? "ERROR";
      const status =
        code === "ACCESS_DENIED"
          ? 403
          : code === "HAS_INFLIGHT_REPORTS" ||
              code === "SCHEDULE_DISPATCHING" ||
              code === "HAS_ACTIVE_RUN"
            ? 409
            : 400;
      return NextResponse.json(
        { error: data?.message ?? "Erro", code },
        { status },
      );
    }
    console.error("hard-delete engagement:", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
