import "server-only";

import { timingSafeEqual } from "node:crypto";

/**
 * Configuração do conector do motor autônomo. Tudo por env (nada no git):
 *  - ENGINE_INGEST_ENABLED: "true" liga o endpoint. Ausente/qualquer-outra =
 *    DESLIGADO → o endpoint responde 404 (invisível). Default off = o platform
 *    fica byte-idêntico ao de hoje (zero retrocesso) e não revela o recurso.
 *  - ENGINE_INGEST_TOKEN: segredo compartilhado com o sidecar (Bearer de máquina).
 *    O box guarda só ESTE token; a serviceKey do Convex fica no platform.
 */

export function isEngineIngestEnabled(): boolean {
  return process.env.ENGINE_INGEST_ENABLED === "true";
}

/** Comparação de tempo constante; false se o token não estiver configurado. */
export function verifyEngineToken(provided: string | null | undefined): boolean {
  const expected = process.env.ENGINE_INGEST_TOKEN;
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
