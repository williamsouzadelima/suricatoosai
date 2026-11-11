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

// Cache CHAVEADO POR PROVIDER (B2): um slot único vazaria a chave de um provider
// para o resolve de outro. Cada provider tem sua própria entrada + TTL.
const cache = new Map<string, { key: ActiveKey; at: number }>();
const TTL_MS = 20_000;
const QUERY_TIMEOUT_MS = 2500;

function serviceKey(): string | null {
  const k = process.env.CONVEX_SERVICE_ROLE_KEY;
  return k && process.env.LLM_KEY_ENC_SECRET ? k : null;
}

async function queryActiveKey(
  excludeIds: string[],
  provider: string,
): Promise<ActiveKey> {
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
          provider,
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
  provider = "openrouter",
): Promise<ActiveKey> {
  if (triedKeyIds.length === 0) {
    const now = Date.now();
    const cached = cache.get(provider);
    if (cached && now - cached.at < TTL_MS) return cached.key;
    const key = await queryActiveKey([], provider);
    cache.set(provider, { key, at: now });
    return key;
  }
  return queryActiveKey(triedKeyIds, provider);
}

/** Limpa o cache de um provider (ou de todos). Chamado pelo admin após mexer no pool (M2). */
export function invalidatePoolKeyCache(provider?: string): void {
  if (provider) cache.delete(provider);
  else cache.clear();
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

/**
 * Marca a chave com erro de autenticação após um 401. Cobre a chave inválida,
 * expirada ou do TIPO ERRADO — uma chave de provisionamento/management do
 * OpenRouter lê o saldo mas NÃO faz inferência, e o /chat/completions responde
 * o enganoso "User not found." (HTTP 401). Fire-and-forget; engole erros.
 */
export async function markPoolKeyAuthError(
  id: string,
  detail: string,
): Promise<void> {
  const sk = serviceKey();
  if (!sk) return;
  try {
    await getConvexClient().mutation(api.llmKeys.setKeyStatusForBackend, {
      serviceKey: sk,
      id: id as Id<"llm_api_keys">,
      status: "error",
      error: detail,
    });
    console.info(`[llm-pool] chave id=${id} marcada com erro de auth (401)`);
  } catch {
    // ignore
  }
}
