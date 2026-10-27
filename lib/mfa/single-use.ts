import { createRedisClient } from "@/lib/rate-limit/redis";

/**
 * Consome o jti da autorização de step-up UMA única vez (Redis SET NX). A rota
 * de download chama isto ANTES de servir bytes:
 *  - "ok"          consumido agora → prossegue;
 *  - "reused"      já consumido (replay) → 401;
 *  - "unavailable" Redis não configurado/erro → FAIL-CLOSED, a rota responde 503
 *                  (nunca vira um token reutilizável).
 */
export async function consumeStepUpJti(
  jti: string,
  expUnixSeconds: number,
): Promise<"ok" | "reused" | "unavailable"> {
  const redis = createRedisClient();
  if (!redis) return "unavailable";
  const ttl = Math.max(1, Math.ceil(expUnixSeconds - Date.now() / 1000));
  try {
    const res = await redis.set(`stepup:jti:${jti}`, "1", { nx: true, ex: ttl });
    return res === "OK" ? "ok" : "reused";
  } catch {
    return "unavailable";
  }
}
