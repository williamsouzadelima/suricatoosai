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
export const UNOROUTER_PROVIDER = "unorouter" as const;

// Placeholder NÃO-OpenAI entregue ao SDK. A chave real vem do pool (ou da env
// dedicada) via fetch; sem pool E sem env o fetch falha fechado, então o
// placeholder — e o OPENAI_API_KEY que o SDK leria — nunca vão para a rede.
const PLACEHOLDER_API_KEY = "pool-managed-no-key";

// Nome da env var DEDICADA do UnoRouter (bootstrap/fallback — espelha
// OPENROUTER_API_KEY). O fallback cai SÓ nesta var; nunca em OPENAI_API_KEY
// (moderação) nem OPENROUTER_API_KEY (B1 — sem vazamento de credencial).
export const UNOROUTER_ENV_KEY_NAME = "UNOROUTER_API_KEY";

/**
 * Lê a chave UnoRouter do ambiente (bootstrap/fallback). Dinâmico: lê
 * process.env a cada chamada (sem cache de módulo), p/ o restart do processo e
 * os testes refletirem na hora. Vazia/ausente → null.
 */
export function readUnoRouterEnvKey(): string | null {
  const v = process.env[UNOROUTER_ENV_KEY_NAME];
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

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
      // Resolve o pool SEMPRE: o 1º envio é seguro mesmo com body não-reenviável
      // (finding A — gatear a resolução pularia o pool p/ streams, regressão).
      // Só a ROTAÇÃO re-envia o request e exige body reenviável (gated abaixo).
      const poolKey = await resolveActivePoolKey(
        triedKeyIds,
        UNOROUTER_PROVIDER,
      );
      if (!poolKey) {
        // Sem chave de pool (vazio/esgotado): BOOTSTRAP/FALLBACK de env (espelha
        // OPENROUTER_API_KEY). A env key é TERMINAL — último recurso, não
        // rotaciona (402/401 dela sobe honesto).
        const envKey = readUnoRouterEnvKey();
        if (!envKey) {
          // FAIL-CLOSED (B1): sem pool E sem UNOROUTER_API_KEY, não envia nada —
          // o placeholder/OPENAI_API_KEY nunca vai p/ api.unorouter.com.
          console.warn(
            "[uno-pool] sem chave de pool nem UNOROUTER_API_KEY -> falha fechada (não envia)",
          );
          return failClosedResponse();
        }
        console.info(
          "[uno-pool] sem chave de pool, usando UNOROUTER_API_KEY do env (bootstrap/fallback)",
        );
        return sendWithKey(fetchImplementation, url, init, envKey);
      }
      const response = await sendWithKey(
        fetchImplementation,
        url,
        init,
        poolKey.plaintext,
      );
      // Só rotaciona com body REENVIÁVEL (string/undefined). Com body não-
      // reenviável o pool é usado 1× e a resposta (mesmo 402/401) sobe como está.
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
