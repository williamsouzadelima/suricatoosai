import type { QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

/**
 * Montagem da enumeração de evidência para o bundle .tar.gz (ver plano
 * "Download de bundle de evidências com trava de MFA"). Compartilhado pelas
 * queries do operador (convex/findings.ts) e do portal (convex/portal.ts) — a
 * AUTORIZAÇÃO (posse / membership) é feita por quem chama, ANTES de paginar.
 */

/** Uma linha de evidência no bundle: identidade do achado pai + todos os campos
 *  de texto da evidência + ponteiro S3 (quando há arquivo). */
export type EvidenceBundleRow = {
  evidenceId: Id<"evidence">;
  findingId: Id<"findings">;
  findingRef: string | null;
  findingTitle: string;
  findingSeverity: string;
  findingWeaknessClass: string;
  sourceType: string;
  label: string | null;
  snippet: string | null;
  stepIndex: number | null;
  toolName: string | null;
  command: string | null;
  resultSummary: string | null;
  s3Key: string | null;
  mediaType: string | null;
  capturedAt: number;
};

export type EvidencePageResult = {
  denied: boolean;
  page: EvidenceBundleRow[];
  isDone: boolean;
  continueCursor: string;
};

/**
 * Uma PÁGINA de TODA a evidência do engajamento (ordem crescente de captura),
 * SEM filtro de status e SEM cap. Memoiza o lookup de achado (não faz ctx.db.get
 * do mesmo finding por linha). A rota faz o loop de páginas até isDone.
 */
export async function collectEvidencePage(
  ctx: QueryCtx,
  engagementId: Id<"engagements">,
  cursor: string | null,
  numItems: number,
): Promise<EvidencePageResult> {
  const res = await ctx.db
    .query("evidence")
    .withIndex("by_engagement_and_captured", (q) =>
      q.eq("engagement_id", engagementId),
    )
    .order("asc")
    .paginate({ cursor, numItems });

  const cache = new Map<
    Id<"findings">,
    {
      ref: string | null;
      title: string;
      severity: string;
      weaknessClass: string;
    }
  >();
  const page: EvidenceBundleRow[] = [];
  for (const ev of res.page) {
    let f = cache.get(ev.finding_id);
    if (!f) {
      const fd = await ctx.db.get(ev.finding_id);
      f = fd
        ? {
            ref: fd.finding_id ?? null,
            title: fd.title,
            severity: fd.severity,
            weaknessClass: fd.weakness_class,
          }
        : {
            ref: null,
            title: "(achado removido)",
            severity: "info",
            weaknessClass: "",
          };
      cache.set(ev.finding_id, f);
    }
    page.push({
      evidenceId: ev._id,
      findingId: ev.finding_id,
      findingRef: f.ref,
      findingTitle: f.title,
      findingSeverity: f.severity,
      findingWeaknessClass: f.weaknessClass,
      sourceType: ev.source_type,
      label: ev.label ?? null,
      snippet: ev.snippet ?? null,
      stepIndex: ev.step_index ?? null,
      toolName: ev.tool_name ?? null,
      command: ev.command ?? null,
      resultSummary: ev.result_summary ?? null,
      s3Key: ev.s3_key ?? null,
      mediaType: ev.media_type ?? null,
      capturedAt: ev.captured_at,
    });
  }
  return {
    denied: false,
    page,
    isDone: res.isDone,
    continueCursor: res.continueCursor,
  };
}
