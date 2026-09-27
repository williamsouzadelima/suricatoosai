import { NextRequest, NextResponse } from "next/server";
import { tasks, auth, idempotencyKeys } from "@trigger.dev/sdk";
import { getInternalUser } from "@/lib/auth/require-internal";
import { getConvexClient } from "@/lib/db/convex-client";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { extractFindingsFromChat } from "@/trigger/extract-findings";

export const runtime = "nodejs";

const TASK_ID = "extract-findings-from-chat";

/**
 * Captura RETROATIVA por IA: anexa um chat concluído ao engajamento e dispara o
 * job que lê a transcrição e grava achados em rascunho para curadoria.
 */
export async function POST(req: NextRequest) {
  const staff = await getInternalUser();
  if (!staff) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const serviceKey = process.env.CONVEX_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return NextResponse.json(
      { error: "Server not configured (CONVEX_SERVICE_ROLE_KEY)" },
      { status: 500 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const chatId = body.chatId;
  const engagementId = body.engagementId;
  if (typeof chatId !== "string" || typeof engagementId !== "string") {
    return NextResponse.json(
      { error: "Parâmetros inválidos" },
      { status: 400 },
    );
  }

  const userId = staff.user.id;

  try {
    // Anexa o chat ao engajamento escolhido (posse verificada no backend).
    await getConvexClient().mutation(
      api.engagements.attachChatToEngagementForBackend,
      {
        serviceKey,
        userId,
        chatId,
        engagementId: engagementId as Id<"engagements">,
      },
    );

    const idempotencyKey = await idempotencyKeys.create(
      [chatId, "extract-findings"],
      { scope: "global" },
    );

    const handle = await tasks.trigger<typeof extractFindingsFromChat>(
      TASK_ID,
      { chatId, userId },
      { idempotencyKey, idempotencyKeyTTL: "10m" },
    );

    const publicAccessToken = await auth.createPublicToken({
      scopes: { read: { runs: [handle.id] } },
      expirationTime: "1h",
    });

    return NextResponse.json({ runId: handle.id, publicAccessToken });
  } catch (error) {
    console.error("Falha ao iniciar extração de achados:", error);
    return NextResponse.json(
      { error: "Falha ao iniciar extração de achados" },
      { status: 500 },
    );
  }
}
