import { workos } from "@/app/api/workos";

/**
 * Helpers de MFA TOTP do WorkOS (classe `multiFactorAuth`). O app é AuthKit/WorkOS
 * e os clientes do portal são org-less, mas são usuários WorkOS — então o fluxo
 * por-fator (listar/desafiar/verificar) funciona tanto p/ operador quanto cliente.
 */

/** Id do fator TOTP VERIFICÁVEL do usuário (ou null se não inscrito). */
export async function getTotpFactorId(userId: string): Promise<string | null> {
  const list = await workos.multiFactorAuth.listUserAuthFactors({ userId });
  const factors = await list.autoPagination();
  const totp = factors.find((f) => f.type === "totp");
  return totp?.id ?? null;
}

/**
 * Desafia o fator TOTP e verifica o código informado AGORA — na MESMA requisição
 * de servidor (um challengeId que fosse/voltasse pelo browser não é validável
 * como do dono: getFactor não traz userId e não há getChallenge).
 */
export async function challengeAndVerifyTotp(
  factorId: string,
  code: string,
): Promise<boolean> {
  const challenge = await workos.multiFactorAuth.challengeFactor({
    authenticationFactorId: factorId,
  });
  const result = await workos.multiFactorAuth.verifyChallenge({
    authenticationChallengeId: challenge.id,
    code,
  });
  return result.valid === true;
}
