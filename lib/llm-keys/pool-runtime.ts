/**
 * Runtime do pool de chaves no caminho de saída do OpenRouter. SERVER-ONLY de
 * fato (usa node:crypto via decryptSecret + Convex serviceKey). TUDO é tolerante
 * a falha: qualquer erro → null/no-op, para NUNCA quebrar uma chamada de LLM
 * (o pior caso é usar a chave do env, que é o comportamento de hoje).
 */

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getConvexClient } from "@/lib/db/convex-client";

import { decryptSecret } from "./crypto";

type ActiveKey = { id: string; plaintext: string } | null;

let cache: { key: ActiveKey; at: number } | null = null;
const TTL_MS = 60_000;

function serviceKey(): string | null {
  const k = process.env.CONVEX_SERVICE_ROLE_KEY;
  // Sem serviceKey OU sem segredo-mestre, o pool não opera → usa a chave do env.
  return k && process.env.LLM_KEY_ENC_SECRET ? k : null;
}

async function queryActiveKey(excludeIds: string[]): Promise<ActiveKey> {
  const sk = serviceKey();
  if (!sk) return null;
  try {
    const row = await getConvexClient().query(
      api.llmKeys.getNextActiveKeyForBackend,
      { serviceKey: sk, excludeIds: excludeIds as Id<"llm_api_keys">[] },
    );
    if (!row) return null;
    const plaintext = decryptSecret({
      ciphertext: row.ciphertext,
      iv: row.iv,
      authTag: row.authTag,
    });
    return { id: row.id as string, plaintext };
  } catch {
    return null;
  }
}

/**
 * Chave do pool a usar nesta chamada. Sem chaves já tentadas, serve do cache
 * (TTL curto → mudanças no admin propagam sem restart). Em rotação (após um
 * 402), consulta fresco excluindo as já falhadas. null → use a chave do env.
 */
export async function resolveActivePoolKey(
  triedKeyIds: string[],
): Promise<ActiveKey> {
  if (triedKeyIds.length === 0) {
    const now = Date.now();
    if (cache && now - cache.at < TTL_MS) return cache.key;
    const key = await queryActiveKey([]);
    cache = { key, at: now };
    return key;
  }
  return queryActiveKey(triedKeyIds);
}

export function invalidatePoolKeyCache(): void {
  cache = null;
}

/** Marca a chave como sem crédito após um 402. Seguro (engole erros). */
export async function markPoolKeyExhausted(id: string): Promise<void> {
  const sk = serviceKey();
  if (!sk) return;
  try {
    await getConvexClient().mutation(api.llmKeys.setKeyStatusForBackend, {
      serviceKey: sk,
      id: id as Id<"llm_api_keys">,
      status: "exhausted",
      error: "HTTP 402 (sem crédito)",
    });
  } catch {
    // ignore
  }
}
