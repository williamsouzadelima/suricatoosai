/**
 * Runtime do pool de chaves no caminho de saída do OpenRouter. SERVER-ONLY de
 * fato (node:crypto via decryptSecret + Convex serviceKey). TUDO tolerante a
 * falha E com TIMEOUT: a consulta do pool NUNCA pode travar/atrasar uma chamada
 * de LLM; qualquer falha/timeout → null (usa a chave do env = hoje).
 */

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getConvexClient } from "@/lib/db/convex-client";

import { decryptSecret } from "./crypto";

type ActiveKey = { id: string; plaintext: string } | null;

let cache: { key: ActiveKey; at: number } | null = null;
const TTL_MS = 20_000;
const QUERY_TIMEOUT_MS = 2500;

function serviceKey(): string | null {
  const k = process.env.CONVEX_SERVICE_ROLE_KEY;
  return k && process.env.LLM_KEY_ENC_SECRET ? k : null;
}

async function queryActiveKey(excludeIds: string[]): Promise<ActiveKey> {
  const sk = serviceKey();
  if (!sk) {
    console.warn("[llm-pool] sem serviceKey/segredo-mestre -> fallback env key");
    return null;
  }
  try {
    const raced = await Promise.race([
      getConvexClient()
        .query(api.llmKeys.getNextActiveKeyForBackend, {
          serviceKey: sk,
          excludeIds: excludeIds as Id<"llm_api_keys">[],
        })
        .then((r) => ({ ok: true as const, r })),
      new Promise<{ ok: false }>((resolve) =>
        setTimeout(() => resolve({ ok: false }), QUERY_TIMEOUT_MS),
      ),
    ]);
    if (!raced.ok) {
      console.warn("[llm-pool] consulta do pool excedeu timeout -> fallback env key");
      return null;
    }
    const row = raced.r;
    if (!row) {
      console.info("[llm-pool] nenhuma chave de pool ativa -> fallback env key");
      return null;
    }
    const plaintext = decryptSecret({
      ciphertext: row.ciphertext,
      iv: row.iv,
      authTag: row.authTag,
    });
    console.info(`[llm-pool] usando chave do pool id=${row.id} (${row.label})`);
    return { id: row.id as string, plaintext };
  } catch (e) {
    console.warn(
      `[llm-pool] erro ao resolver chave do pool: ${e instanceof Error ? e.message : String(e)}`,
    );
    return null;
  }
}

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

/** Marca a chave como sem crédito após um 402. Fire-and-forget; engole erros. */
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
    console.info(`[llm-pool] chave id=${id} marcada sem crédito (402)`);
  } catch {
    // ignore
  }
}
