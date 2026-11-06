import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { ConvexError } from "convex/values";
import { internal } from "../_generated/api";

/**
 * Helpers genéricos de cascata batcheada — espelham o motor PRIVADO de
 * convex/userDeletion.ts (que NÃO exporta nada e é fortemente testado; não
 * tocamos nele). Duplicados aqui de propósito para o hardDeleteEngagement
 * (convex/engagementHardDelete.ts) reusar sem acoplar ao caminho de exclusão de
 * conta. Mantém o mesmo contrato: orçamento de leitura compartilhado por chamada
 * + re-chamada dirigida pelo chamador enquanto `hasMore`.
 */

export type CleanupMode = "execute" | "dryRun";
export type ReadBudget = { remaining: number };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDoc = { _id: Id<any>; [key: string]: any };

export function increment(
  target: Record<string, number>,
  key: string,
  count: number,
) {
  if (count === 0) return;
  target[key] = (target[key] ?? 0) + count;
}

export function uniqueDocs<T extends AnyDoc>(
  docs: Array<T | null | undefined>,
): T[] {
  const byId = new Map<string, T>();
  for (const doc of docs) {
    if (!doc) continue;
    byId.set(String(doc._id), doc);
  }
  return Array.from(byId.values());
}

/**
 * Lê um lote de um índice respeitando o orçamento compartilhado. Reserva uma
 * leitura para o lookahead que determina `hasMore`. Decrementa o orçamento pelo
 * número de linhas lidas (= linhas que serão apagadas → progresso garantido por
 * chamada no modo execute).
 */
export async function collectByIndexBatch<T extends AnyDoc>(
  ctx: MutationCtx,
  budget: ReadBudget,
  table: string,
  indexName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  build: (q: any) => any,
  requestedLimit: number,
): Promise<{ docs: T[]; hasMore: boolean }> {
  const limit = Math.min(requestedLimit, budget.remaining - 1);
  if (limit <= 0) return { docs: [], hasMore: true };
  const rows = await (ctx.db.query(table as never) as never as {
    withIndex: (
      name: string,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      b: (q: any) => any,
    ) => { take: (n: number) => Promise<T[]> };
  })
    .withIndex(indexName, build)
    .take(limit + 1);
  budget.remaining -= rows.length;
  const hasMore = rows.length > limit;
  return { docs: hasMore ? rows.slice(0, limit) : rows, hasMore };
}

/** Conta sempre; só apaga no modo execute. */
export async function deleteDocs(
  ctx: MutationCtx,
  deleted: Record<string, number>,
  table: string,
  docs: Array<AnyDoc | null | undefined>,
  mode: CleanupMode,
) {
  const unique = uniqueDocs(docs);
  increment(deleted, table, unique.length);
  if (mode === "dryRun") return;
  for (const doc of unique) await ctx.db.delete(doc._id);
}

/**
 * Enfileira deleção de objetos S3 em lotes de no máximo 50 (a action não tem
 * limite, mas mantemos bounded). Dedupe por chave. No modo dryRun só conta.
 * Retorna o número de chaves (únicas, não vazias).
 */
export async function enqueueS3DeleteBatch(
  ctx: MutationCtx,
  s3Keys: string[],
  mode: CleanupMode,
): Promise<number> {
  const keys = Array.from(
    new Set(
      s3Keys.filter((k): k is string => typeof k === "string" && k.length > 0),
    ),
  );
  if (mode === "dryRun" || keys.length === 0) return keys.length;
  for (let i = 0; i < keys.length; i += 50) {
    await ctx.scheduler.runAfter(
      0,
      internal.s3Cleanup.deleteS3ObjectsBatchAction,
      { s3Keys: keys.slice(i, i + 50) },
    );
  }
  return keys.length;
}

/**
 * Guarda de escritor: recusa quando o engajamento foi excluído definitivamente
 * (lápide hard_deleted_at). A ÚNICA mutação autorizada a escrever além da lápide
 * é a própria cascata (hardDeleteEngagementForBackend). Todo escritor de backend
 * que pode disparar DEPOIS do início da exclusão chama isto.
 */
export async function assertEngagementLive(
  ctx: MutationCtx,
  engagementId: Id<"engagements">,
): Promise<void> {
  const eng = await ctx.db.get(engagementId);
  if (eng?.hard_deleted_at) {
    throw new ConvexError({
      code: "ENGAGEMENT_DELETED",
      message: "Engajamento foi excluído definitivamente.",
    });
  }
}
