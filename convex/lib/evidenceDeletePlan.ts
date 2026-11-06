import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

/**
 * SELEÇÃO de chaves S3 da exclusão definitiva — a margem de segurança do
 * hard-delete, isolada numa função PURA (importa só tipos → testável sem puxar
 * fileAggregate/@convex-dev/aggregate, que são ESM e o jest não transforma).
 *
 * Dado um lote de evidências que SERÃO apagadas, decide:
 *  - quais `files` ficam órfãos (nenhuma evidência SOBREVIVENTE os referencia —
 *    mensagens de chat são ignoradas de propósito, decisão D1) → apagar + S3;
 *  - quais `s3_key` diretos (evidência sem file, ou chave divergente) são seguros
 *    de enfileirar: SÓ quando NENHUM `files` possui a chave — senão apagaria o
 *    objeto de um `files` sobrevivente (possivelmente de OUTRO engajamento).
 */
export type EvidenceDeletePlan = {
  filesToDelete: Doc<"files">[];
  s3KeysToEnqueue: string[];
};

export async function planEvidenceDeletion(
  ctx: MutationCtx,
  evidenceBatch: Array<Doc<"evidence">>,
  evidenceRefScanCap: number,
): Promise<EvidenceDeletePlan> {
  const deletedEvidenceIds = new Set<string>();
  const directKeys: string[] = [];
  const touchedFiles = new Set<string>();
  for (const ev of evidenceBatch) {
    if (ev.s3_key) directKeys.push(ev.s3_key);
    if (ev.file_id) touchedFiles.add(String(ev.file_id));
    deletedEvidenceIds.add(String(ev._id));
  }

  const filesToDelete: Doc<"files">[] = [];
  const fileKeys: string[] = [];
  for (const fidStr of touchedFiles) {
    const fid = fidStr as Id<"files">;
    const refs = await ctx.db
      .query("evidence")
      .withIndex("by_file_id", (q) => q.eq("file_id", fid))
      .take(evidenceRefScanCap);
    // >= cap: não dá p/ provar que não sobrevive ninguém → conservador (mantém).
    const surviving =
      refs.length >= evidenceRefScanCap ||
      refs.some((r) => !deletedEvidenceIds.has(String(r._id)));
    if (surviving) continue;
    const file = await ctx.db.get(fid);
    if (!file) continue;
    filesToDelete.push(file);
    if (file.s3_key) fileKeys.push(file.s3_key);
  }

  const safeDirect: string[] = [];
  for (const k of directKeys) {
    const owner = await ctx.db
      .query("files")
      .withIndex("by_s3_key", (q) => q.eq("s3_key", k))
      .first();
    if (!owner) safeDirect.push(k);
  }

  return { filesToDelete, s3KeysToEnqueue: [...fileKeys, ...safeDirect] };
}
