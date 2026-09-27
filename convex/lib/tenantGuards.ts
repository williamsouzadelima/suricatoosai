import { ConvexError } from "convex/values";
import type { UserIdentity } from "convex/server";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Doc, Id, TableNames } from "../_generated/dataModel";

/**
 * tenantGuards — checagem de tenant ÚNICA e sancionada para as tabelas de
 * domínio (clients, engagements, findings, evidence, reports, ...). É o que o
 * plano chamou de "withTenantScope": em vez de reimplementar
 * `identity.subject === doc.user_id` inline em cada função (e arriscar que uma
 * função NOVA esqueça), toda leitura/escrita tenant-scoped passa por aqui.
 *
 * Dois modos, para preservar o comportamento existente:
 *   - requireOwnedDoc: LANÇA (UNAUTHORIZED / ACCESS_DENIED). Use em mutations e
 *     leituras que devem falhar duro.
 *   - getOwnedDoc: NULLABLE (retorna null). Use em read-queries que devolvem
 *     null/[] em vez de erro.
 *
 * A restrição de tipo `OwnedTable` garante em tempo de COMPILAÇÃO que só é
 * possível chamar estes helpers com o Id de uma tabela que realmente carrega
 * `user_id` — um erro de digitação de tabela não compila.
 */

type AnyCtx = QueryCtx | MutationCtx;

/** União das tabelas cujo documento carrega `user_id: string` (tenant-scoped). */
export type OwnedTable = {
  [T in TableNames]: Doc<T> extends { user_id: string } ? T : never;
}[TableNames];

type Owned<T extends OwnedTable> = {
  identity: UserIdentity;
  subject: string;
  doc: Doc<T>;
};

/** Identidade autenticada obrigatória; lança UNAUTHORIZED se ausente. */
export async function requireIdentity(ctx: AnyCtx): Promise<UserIdentity> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new ConvexError({ code: "UNAUTHORIZED", message: "Unauthorized" });
  }
  return identity;
}

/**
 * Busca um doc por id e EXIGE posse (doc.user_id === identity.subject). Lança
 * UNAUTHORIZED (sem sessão) ou ACCESS_DENIED (inexistente / não é o dono).
 */
export async function requireOwnedDoc<T extends OwnedTable>(
  ctx: AnyCtx,
  id: Id<T>,
): Promise<Owned<T>> {
  const identity = await requireIdentity(ctx);
  const doc = await ctx.db.get(id);
  if (!doc || (doc as Record<string, unknown>).user_id !== identity.subject) {
    throw new ConvexError({ code: "ACCESS_DENIED", message: "Sem acesso" });
  }
  return { identity, subject: identity.subject, doc };
}

/**
 * Variante NULLABLE (não lança): null quando não há sessão OU o doc não pertence
 * ao usuário. Para read-queries que retornam null/[] em vez de erro.
 */
export async function getOwnedDoc<T extends OwnedTable>(
  ctx: AnyCtx,
  id: Id<T>,
): Promise<Owned<T> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  const doc = await ctx.db.get(id);
  if (!doc || (doc as Record<string, unknown>).user_id !== identity.subject) {
    return null;
  }
  return { identity, subject: identity.subject, doc };
}
