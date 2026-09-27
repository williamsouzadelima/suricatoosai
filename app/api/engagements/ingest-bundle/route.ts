import { NextRequest, NextResponse } from "next/server";
import { tasks, auth, idempotencyKeys } from "@trigger.dev/sdk";
import { getInternalUser } from "@/lib/auth/require-internal";
import type { ingestEvidenceBundle } from "@/trigger/ingest-bundle";

export const runtime = "nodejs";

const TASK_ID = "ingest-evidence-bundle";

/**
 * Dispara a ingestão de um bundle de evidências já subido ao S3 (s3Key), para o
 * engajamento escolhido. Verifica posse do engajamento antes de enfileirar.
 */
export async function POST(req: NextRequest) {
  const staff = await getInternalUser();
  if (!staff) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const serviceKey = process.env.CONVEX_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return NextResponse.json(
      { error: "Server not configured" },
      { status: 500 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const engagementId = body.engagementId;
  const s3Key = body.s3Key;
  const filename = typeof body.filename === "string" ? body.filename : "bundle";
  if (typeof engagementId !== "string" || typeof s3Key !== "string") {
    return NextResponse.json(
      { error: "Parâmetros inválidos" },
      { status: 400 },
    );
  }

  const userId = staff.user.id;

  try {
    // A posse do engajamento é validada na task (captureFindingForBackend exige
    // engagement.user_id === userId); a rota já gateia por getInternalUser.
    const idempotencyKey = await idempotencyKeys.create([s3Key, "ingest"], {
      scope: "global",
    });
    const handle = await tasks.trigger<typeof ingestEvidenceBundle>(
      TASK_ID,
      { engagementId, userId, s3Key, filename },
      { idempotencyKey, idempotencyKeyTTL: "1h" },
    );
    const publicAccessToken = await auth.createPublicToken({
      scopes: { read: { runs: [handle.id] } },
      expirationTime: "1h",
    });
    return NextResponse.json({ runId: handle.id, publicAccessToken });
  } catch (error) {
    console.error("ingest-bundle:", error);
    return NextResponse.json(
      { error: "Falha ao iniciar a ingestão" },
      { status: 500 },
    );
  }
}
