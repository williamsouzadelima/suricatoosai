import { isFreeModelSelection, type SelectedModel } from "@/types/chat";
import { getChatById } from "@/lib/db/actions";

/**
 * Portão duro dos modelos GRATUITOS (OpenRouter `:free`). Esses provedores podem
 * TREINAR com o prompt, então um modelo free só pode servir chat SEM
 * engajamento/cliente (`chats.engagement_id` ausente). Roda no SERVIDOR — no
 * handler HTTP E na task do trigger (que re-deriva do payload bruto) — e NUNCA
 * confia no cliente. Quem chama já tem o chat carregado e o PASSA (`chat`),
 * evitando releitura e o caminho de falha de leitura; só consulta o Convex
 * quando não recebeu o chat. Falha de consulta = FAIL-CLOSED. Direção segura:
 * free → "auto" (pago). Jamais o inverso.
 *
 * Complementos (o portão de entrada não basta sozinho): em run free, o
 * createTools NÃO provisiona engajamento nem expõe capture_finding
 * (CreateToolsRuntimePolicy.engagementBindingAllowed=false), e o run RE-CHECA
 * o vínculo em cada createStream/retomada (agent-long). Ver [[git-sem-dados-de-pentest]].
 */

export interface FreeModelGateResult {
  /** Override efetivo p/ o selectModel (rebaixado p/ "auto" quando bloqueado). */
  override: SelectedModel | undefined;
  /** true quando um free foi BLOQUEADO (chat de engajamento OU leitura falhou). */
  blockedByEngagement: boolean;
  reason?: "engagement" | "lookup_failed";
}

type ChatLike = { engagement_id?: unknown } | null | undefined;
type ChatLookup = (args: { id: string }) => Promise<ChatLike>;

export async function enforceFreeModelEngagementGate({
  selectedModelOverride,
  chatId,
  chat,
  lookupChat = getChatById,
  log = console,
}: {
  selectedModelOverride: SelectedModel | undefined;
  chatId: string | undefined;
  /** Chat JÁ carregado pelo chamador. `null` = chat novo (sem registro). Se
   *  `undefined`, o portão consulta o Convex via `lookupChat`. */
  chat?: ChatLike;
  /** Injetável p/ teste; padrão = leitura real do Convex com retry. */
  lookupChat?: ChatLookup;
  log?: Pick<Console, "warn">;
}): Promise<FreeModelGateResult> {
  // Não é free: passa direto, sem I/O.
  if (!isFreeModelSelection(selectedModelOverride)) {
    return { override: selectedModelOverride, blockedByEngagement: false };
  }

  let resolved: ChatLike;
  if (chat !== undefined) {
    resolved = chat; // já em mãos (inclusive null = chat novo)
  } else if (!chatId) {
    return { override: selectedModelOverride, blockedByEngagement: false };
  } else {
    try {
      resolved = await lookupChat({ id: chatId });
    } catch (error) {
      // FAIL-CLOSED: sem saber se há cliente no chat, NÃO libera modelo que treina.
      log.warn(
        JSON.stringify({
          level: "warn",
          event: "free_model_gate_lookup_failed",
          chat_id: chatId,
          selected_model: selectedModelOverride,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      return {
        override: "auto",
        blockedByEngagement: true,
        reason: "lookup_failed",
      };
    }
  }

  // Chat inexistente (novo) → sem engajamento ainda → free permitido.
  if (resolved?.engagement_id) {
    log.warn(
      JSON.stringify({
        level: "warn",
        event: "free_model_blocked_by_engagement",
        chat_id: chatId,
        selected_model: selectedModelOverride,
      }),
    );
    return { override: "auto", blockedByEngagement: true, reason: "engagement" };
  }

  return { override: selectedModelOverride, blockedByEngagement: false };
}

/**
 * Re-checagem DURANTE o run (TOCTOU): o chat pode ser anexado a um engajamento
 * horas depois do portão de entrada (pela UI ou por captura lazy). Chamar antes
 * de cada createStream/retomada quando o override efetivo é free; lança se o
 * chat agora tem engajamento — o run aborta em vez de seguir no provedor que
 * treina (não rebaixa em silêncio: o contexto acumulado já foi pro free).
 */
export class FreeModelEngagementViolationError extends Error {
  readonly code = "free_model_engagement_violation" as const;
  constructor(chatId: string) {
    super(
      `Chat ${chatId} foi vinculado a um engajamento/cliente durante o run; modelo gratuito não é mais autorizado.`,
    );
    this.name = "FreeModelEngagementViolationError";
  }
}

export async function assertFreeModelStillAllowed({
  selectedModelOverride,
  chatId,
  lookupChat = getChatById,
}: {
  selectedModelOverride: SelectedModel | undefined;
  chatId: string;
  lookupChat?: ChatLookup;
}): Promise<void> {
  if (!isFreeModelSelection(selectedModelOverride)) return;
  let chat: ChatLike;
  try {
    chat = await lookupChat({ id: chatId });
  } catch {
    // FAIL-CLOSED também aqui: sem conseguir confirmar, não continua no free.
    throw new FreeModelEngagementViolationError(chatId);
  }
  if (chat?.engagement_id) throw new FreeModelEngagementViolationError(chatId);
}

/**
 * Guarda POR PASSO p/ o runner (`AgentStreamContext.beforeStep`): em run free,
 * re-checa o vínculo com engajamento no máximo a cada `intervalMs` (evita uma
 * leitura no Convex por passo). Não-free → no-op. Lança p/ abortar o run.
 */
export function createFreeModelStepGuard({
  selectedModelOverride,
  chatId,
  intervalMs = 30_000,
  lookupChat,
}: {
  selectedModelOverride: SelectedModel | undefined;
  chatId: string;
  intervalMs?: number;
  lookupChat?: ChatLookup;
}): () => Promise<void> {
  if (!isFreeModelSelection(selectedModelOverride)) return async () => {};
  let lastCheckedAt = 0;
  return async () => {
    const now = Date.now();
    if (now - lastCheckedAt < intervalMs) return;
    lastCheckedAt = now;
    await assertFreeModelStillAllowed({ selectedModelOverride, chatId, lookupChat });
  };
}
