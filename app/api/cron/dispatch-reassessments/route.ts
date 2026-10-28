import { NextRequest, NextResponse } from "next/server";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { getConvexClient } from "@/lib/db/convex-client";
import { api } from "@/convex/_generated/api";

export const runtime = "nodejs";

/**
 * Dispatcher das reavaliações agendadas (recorrência). Espelha
 * /api/cron/dispatch-campaigns: um timer externo (Kali) bate aqui com o
 * CRON_SECRET. Para cada agendamento vencido: aplica o PORTÃO DURO de `ends_at`
 * (janela de autorização) e, se dentro da janela, monta um RASCUNHO (chat
 * vinculado ao engajamento + `pending_prompt` semeado + modo agente) que o
 * operador lança com 1 clique. NUNCA dispara o agent-long — o lançamento é o
 * envio do operador. O escopo também entra no system prompt via Fatia 2.
 */

const MAX_PER_RUN = 20;

// Comparação em tempo constante (SHA-256 → buffers fixos, sem vazar tamanho),
// idêntica ao gate de dispatch-campaigns.
function safeEqual(provided: string, expected: string): boolean {
  if (!provided) return false;
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // sem segredo, o dispatcher fica fechado
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const headerSecret = req.headers.get("x-cron-secret") ?? "";
  return safeEqual(bearer, secret) || safeEqual(headerSecret, secret);
}

function buildPrompt(name: string, inScope: string[]): string {
  const lines = [
    `Reavaliação agendada do engajamento "${name}".`,
    "",
    "Execute uma nova rodada de teste de intrusão no escopo autorizado deste engajamento e destaque o que mudou desde a última avaliação: vulnerabilidades novas, corrigidas ou ainda abertas.",
  ];
  if (inScope.length > 0) {
    lines.push("", "Alvos em escopo:", ...inScope.slice(0, 50).map((t) => `- ${t}`));
  }
  lines.push(
    "",
    "As exclusões e a janela de autorização estão no contexto do engajamento — não saia do escopo autorizado.",
  );
  return lines.join("\n");
}

type ItemResult = {
  engagementId: string;
  outcome: "dispatched" | "failed" | "expired";
  chatId?: string;
};

async function run(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const serviceKey = process.env.CONVEX_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return NextResponse.json({ error: "Server not configured" }, { status: 500 });
  }

  const convex = getConvexClient();
  const results: ItemResult[] = [];

  for (let i = 0; i < MAX_PER_RUN; i++) {
    const claim = await convex.mutation(
      api.engagements.claimNextDueForBackend,
      { serviceKey },
    );
    if (!claim.found || !claim.id || !claim.engagementId || !claim.userId) break;
    const id = claim.id;
    const engagementId = claim.engagementId;
    const userId = claim.userId;

    try {
      const scope = await convex.query(
        api.engagements.getEngagementScopeForBackend,
        { serviceKey, userId, engagementId },
      );
      // Engajamento sumiu / sem acesso → falha (re-arma e tenta no próximo ciclo).
      if (!scope) {
        await convex.mutation(api.engagements.markResultForBackend, {
          serviceKey,
          id,
          outcome: "failed",
          error: "engajamento inacessível",
        });
        results.push({ engagementId, outcome: "failed" });
        continue;
      }

      // PORTÃO DURO: janela de autorização expirada → pausa (não cria rascunho,
      // não re-arma). Rodar fora da janela seria teste não-autorizado.
      if (typeof scope.ends_at === "number" && Date.now() > scope.ends_at) {
        await convex.mutation(api.engagements.markResultForBackend, {
          serviceKey,
          id,
          outcome: "expired",
        });
        results.push({ engagementId, outcome: "expired" });
        continue;
      }

      const chatId = randomUUID();
      const inScope = (scope.scope ?? [])
        .filter((s) => s.in_scope)
        .map((s) => `${s.kind}: ${s.value}`);
      const title = `Reavaliação: ${scope.name}`.slice(0, 100);
      const prompt = buildPrompt(scope.name, inScope);

      // Cria o chat → vincula ao engajamento → semeia o rascunho (modo agente).
      await convex.mutation(api.chats.saveChat, {
        serviceKey,
        id: chatId,
        userId,
        title,
      });
      await convex.mutation(
        api.engagements.attachChatToEngagementForBackend,
        { serviceKey, userId, chatId, engagementId },
      );
      await convex.mutation(
        api.engagements.setReassessmentDraftFieldsForBackend,
        { serviceKey, chatId, userId, pendingPrompt: prompt },
      );
      await convex.mutation(api.engagements.markResultForBackend, {
        serviceKey,
        id,
        outcome: "dispatched",
        chatId,
      });
      results.push({ engagementId, outcome: "dispatched", chatId });
    } catch (e) {
      await convex.mutation(api.engagements.markResultForBackend, {
        serviceKey,
        id,
        outcome: "failed",
        error: e instanceof Error ? e.message.slice(0, 300) : "erro",
      });
      results.push({ engagementId, outcome: "failed" });
      console.error(
        "[dispatch-reassessments] falha",
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  return NextResponse.json({ processed: results.length, results });
}

export async function POST(req: NextRequest) {
  return run(req);
}
export async function GET(req: NextRequest) {
  return run(req);
}
