/**
 * Provider UnoRouter (gateway OpenAI-compat, api.unorouter.com/v1) — serve SÓ os
 * modelos do grupo "Gratuitos". Chave gerida no pool do admin (provider
 * "unorouter"), cifrada; failover por crédito (402) / auth (401).
 *
 * NÃO aplica os transforms específicos do OpenRouter (Kimi/xAI/reasoning/PDF/
 * metadata header) — eles não significam nada para o UnoRouter (L3).
 *
 * B1 (vazamento de credencial): o `createOpenAI` recebe um apiKey PLACEHOLDER
 * (jamais o OPENAI_API_KEY que o SDK OpenAI leria por padrão). Este fetch
 * sobrescreve a Authorization com a chave do pool e FALHA FECHADA quando não há
 * chave de pool — o placeholder/segredo nunca sai para a rede.
 */
import { createOpenAI } from "@ai-sdk/openai";

import {
  invalidatePoolKeyCache,
  markPoolKeyAuthError,
  markPoolKeyExhausted,
  resolveActivePoolKey,
} from "@/lib/llm-keys/pool-runtime";

export const UNOROUTER_BASE_URL = "https://api.unorouter.com/v1";
export const UNOROUTER_PROVIDER = "unorouter";

// Placeholder NÃO-OpenAI entregue ao SDK. A chave real vem do pool via fetch; se
// o pool estiver vazio o fetch falha fechado, então isto nunca vai para a rede.
const PLACEHOLDER_API_KEY = "pool-managed-no-key";

function failClosedResponse(): Response {
  return new Response(
    JSON.stringify({
      error: {
        // Honesto: resolveActivePoolKey devolve null tanto SEM chave quanto
        // quando TODAS as chaves UnoRouter estão sem crédito/erro (finding #3).
        message:
          "Sem chave UnoRouter ATIVA no pool (não configurada, ou todas sem crédito/erro) — verifique no admin (Chaves LLM) para usar os modelos gratuitos.",
        type: "no_active_unorouter_key",
        code: "no_active_unorouter_key",
      },
    }),
    { status: 503, headers: { "content-type": "application/json" } },
  );
}

async function sendWithKey(
  fetchImplementation: typeof fetch,
  url: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1],
  authBearer: string,
): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${authBearer}`);
  return fetchImplementation(url, { ...init, headers });
}

export const createUnoRouterPatchFetch =
  (fetchImplementation: typeof fetch = globalThis.fetch): typeof fetch =>
  async (url, init) => {
    const bodyReusable =
      init?.body === undefined || typeof init.body === "string";
    const triedKeyIds: string[] = [];
    for (;;) {
      const poolKey = await resolveActivePoolKey(
        triedKeyIds,
        UNOROUTER_PROVIDER,
      );
      if (!poolKey) {
        // FAIL-CLOSED (B1): sem chave de pool UnoRouter, não envia nada.
        console.warn(
          "[uno-pool] sem chave de pool UnoRouter -> falha fechada (não envia)",
        );
        return failClosedResponse();
      }
      const response = await sendWithKey(
        fetchImplementation,
        url,
        init,
        poolKey.plaintext,
      );
      if (
        bodyReusable &&
        (response.status === 402 || response.status === 401)
      ) {
        if (response.status === 402) {
          void markPoolKeyExhausted(poolKey.id);
        } else {
          void markPoolKeyAuthError(
            poolKey.id,
            "HTTP 401 — chave UnoRouter inválida ou expirada.",
          );
        }
        triedKeyIds.push(poolKey.id);
        invalidatePoolKeyCache(UNOROUTER_PROVIDER);
        continue;
      }
      return response;
    }
  };

/** Instância OpenAI-compat apontada ao UnoRouter, com failover de pool + fail-closed. */
export function createUnoRouterProvider() {
  return createOpenAI({
    // model.provider vira "unorouter.chat" → detecção ROBUSTA do que é uno-roteado
    // no provider-map (o teste de paridade do portão deriva disto, não de uma
    // constante-espelho — MED-1). O sufixo .chat/.responses também guarda o #1.
    name: UNOROUTER_PROVIDER,
    apiKey: PLACEHOLDER_API_KEY,
    baseURL: UNOROUTER_BASE_URL,
    fetch: createUnoRouterPatchFetch(),
  });
}
