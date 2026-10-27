import type { NextRequest } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { createRedisClient } from "@/lib/rate-limit/redis";
import { getConvexClient } from "@/lib/db/convex-client";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getTotpFactorId, challengeAndVerifyTotp } from "./workos-mfa";
import { mintStepUpToken, type ActorKind } from "./step-up-token";

/**
 * Orquestração do step-up MFA do download de evidências, compartilhada pelas
 * rotas do operador e do portal. Faz: rate-limit (ANTES do WorkOS) → desafio+
 * verificação TOTP → auditoria (challenge/verify) → mint da autorização curta.
 * Fail-closed: sem Redis, 503 (não vira replay).
 */

export type StepUpResult =
  | { ok: true; token: string; expSeconds: number }
  | { ok: false; status: number; error: string };

let limiter: Ratelimit | null = null;
let limiterInit = false;
function getLimiter(): Ratelimit | null {
  if (limiterInit) return limiter;
  limiterInit = true;
  const redis = createRedisClient();
  limiter = redis
    ? new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(5, "10 m"),
        prefix: "mfa-verify",
      })
    : null;
  return limiter;
}

export async function evidenceBundleStepUpVerify(input: {
  req: NextRequest;
  actorKind: ActorKind;
  userId: string;
  email?: string;
  engagementId: string;
  code: string;
}): Promise<StepUpResult> {
  const { req, actorKind, userId, email, engagementId, code } = input;
  const serviceKey = process.env.CONVEX_SERVICE_ROLE_KEY;
  if (!serviceKey) return { ok: false, status: 500, error: "server_not_configured" };

  // Rate-limit ANTES de qualquer chamada ao WorkOS (um código errado queima um
  // desafio). Sem Redis → fail-closed 503.
  const rl = getLimiter();
  if (!rl) return { ok: false, status: 503, error: "rate_limit_unavailable" };
  const { success } = await rl.limit(`${actorKind}:${userId}`);
  if (!success) return { ok: false, status: 429, error: "too_many_attempts" };

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const userAgent = req.headers.get("user-agent") ?? undefined;
  const convex = getConvexClient();
  const audit = (
    eventType: "mfa.challenge_issued" | "mfa.verify_failed" | "mfa.verify_succeeded",
    outcome: "success" | "denied",
  ) =>
    convex
      .mutation(api.securityAudit.recordSecurityEventForBackend, {
        serviceKey,
        eventType,
        actorUserId: userId,
        actorEmail: email,
        actorKind,
        engagementId: engagementId as Id<"engagements">,
        targetType: "evidence_bundle",
        targetId: engagementId,
        ip,
        userAgent,
        outcome,
      })
      .catch((e) => {
        console.error("mfa: falha ao auditar", e);
      });

  const factorId = await getTotpFactorId(userId);
  if (!factorId) return { ok: false, status: 409, error: "no_mfa_factor" };

  await audit("mfa.challenge_issued", "success");
  let valid = false;
  try {
    valid = await challengeAndVerifyTotp(factorId, code);
  } catch (e) {
    console.error("mfa: challenge/verify erro", e);
    valid = false;
  }
  if (!valid) {
    await audit("mfa.verify_failed", "denied");
    return { ok: false, status: 401, error: "invalid_code" };
  }
  await audit("mfa.verify_succeeded", "success");
  const { token, expSeconds } = await mintStepUpToken({
    userId,
    actorKind,
    engagementId,
  });
  return { ok: true, token, expSeconds };
}
