import { SignJWT, jwtVerify } from "jose";

/**
 * Autorização curta de "step-up" pós-MFA p/ baixar o bundle de evidências.
 * JWT HS256 (jose), 2.5 min, uso único (o jti é consumido no Redis pela rota de
 * download — ver lib/mfa/single-use.ts). Vinculado a userId + engagement + ator
 * + escopo, pra não valer p/ outro usuário/engajamento. Segredo em env dedicado
 * EVIDENCE_STEPUP_TOKEN_SECRET (NUNCA reusar WORKOS_COOKIE_PASSWORD).
 */

const ISSUER = "suricatoos-mfa-stepup";
const AUDIENCE = "evidence-bundle-download";
const SCOPE = "evidence-bundle";
export const STEP_UP_TTL_SECONDS = 150; // 2.5 min
export const STEP_UP_COOKIE = "suricatoos_ev_stepup";

export type ActorKind = "internal" | "client";

export type StepUpClaims = {
  sub: string;
  act: ActorKind;
  eng: string;
  scope: string;
  jti: string;
  exp: number;
  iat: number;
};

function secret(): Uint8Array {
  const s = process.env.EVIDENCE_STEPUP_TOKEN_SECRET;
  if (!s || s.length < 16) {
    throw new Error("EVIDENCE_STEPUP_TOKEN_SECRET ausente ou fraco");
  }
  return new TextEncoder().encode(s);
}

export async function mintStepUpToken(input: {
  userId: string;
  actorKind: ActorKind;
  engagementId: string;
}): Promise<{ token: string; jti: string; expSeconds: number }> {
  const jti = crypto.randomUUID();
  const token = await new SignJWT({
    act: input.actorKind,
    eng: input.engagementId,
    scope: SCOPE,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(input.userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setJti(jti)
    .setIssuedAt()
    .setExpirationTime(`${STEP_UP_TTL_SECONDS}s`)
    .sign(secret());
  return { token, jti, expSeconds: STEP_UP_TTL_SECONDS };
}

/**
 * Verifica assinatura/exp/issuer/audience E faz o BIND a userId+engagement+ator+
 * escopo. Lança em qualquer divergência (a rota responde 401 step_up_required).
 */
export async function verifyStepUpToken(
  token: string | undefined,
  bind: { userId: string; engagementId: string; actorKind: ActorKind },
): Promise<StepUpClaims> {
  if (!token) throw new Error("step_up_required");
  const { payload } = await jwtVerify(token, secret(), {
    issuer: ISSUER,
    audience: AUDIENCE,
  });
  const claims = payload as unknown as StepUpClaims;
  if (
    claims.scope !== SCOPE ||
    claims.sub !== bind.userId ||
    claims.eng !== bind.engagementId ||
    claims.act !== bind.actorKind ||
    typeof claims.jti !== "string" ||
    typeof claims.exp !== "number"
  ) {
    throw new Error("step_up_bind_mismatch");
  }
  return claims;
}
