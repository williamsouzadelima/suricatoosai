import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { ConvexError } from "convex/values";
import {
  type CleanupMode,
  type ReadBudget,
  collectByIndexBatch,
  deleteDocs,
  increment,
  enqueueS3DeleteBatch,
} from "./cascade";
import { fileCountAggregate } from "../fileAggregate";
import { planEvidenceDeletion } from "./evidenceDeletePlan";
import { internal } from "../_generated/api";

/**
 * LÓGICA da exclusão DEFINITIVA (irreversível) de um engajamento. Os wrappers
 * Convex (serviceKey) vivem em convex/engagements.ts — assim `api.engagements.*`
 * resolve SEM codegen (o tipo flui via typeof do módulo existente). Esta lib é
 * pura o bastante p/ testar isolada (só importa cascade + fileAggregate).
 *
 * Decisões (travadas com o William): D1 apaga S3 mesmo que um chat referencie
 * (só preserva files se OUTRA evidência SOBREVIVENTE referenciar); D2 limpa
 * scope/starts_at/ends_at; D3 RECUSA com run ativo (não cancela); D4 S3 sem
 * retry; D6 chats DESANEXADOS com suppress_auto_engagement. PRESERVA faturas,
 * usage_logs e o security_audit_log (imutável). Engajamento vira LÁPIDE.
 */

const EV_BATCH = 25;
const FINDING_BATCH = 10;
const REPORT_BATCH = 50;
const CHAT_BATCH = 50;
const GENERIC_BATCH = 100;
const CALL_READ_BUDGET = 100;
const REPORT_SCAN_CAP = 200;
const CHAT_SCAN_CAP = 200;
const EVIDENCE_REF_SCAN_CAP = 25;
const RUN_STALE_MS = 15 * 60 * 1000;
const SCHED_LEASE_MS = 5 * 60 * 1000;

export type HardDeleteResult = {
  phase: string;
  hasMore: boolean;
  deleted: Record<string, number>;
  detached: number;
  s3ObjectsQueued: number;
  dryRun: boolean;
};

export async function getEngagementOwner(
  ctx: QueryCtx,
  engagementId: Id<"engagements">,
): Promise<{
  userId: string;
  name: string;
  hardDeletedAt: number | null;
} | null> {
  const eng = await ctx.db.get(engagementId);
  if (!eng) return null;
  return {
    userId: eng.user_id,
    name: eng.name,
    hardDeletedAt: eng.hard_deleted_at ?? null,
  };
}

export async function runEngagementHardDelete(
  ctx: MutationCtx,
  params: {
    engagementId: Id<"engagements">;
    expectedOwnerUserId: string;
    actorUserId: string;
    mode: CleanupMode;
  },
): Promise<HardDeleteResult> {
  const { engagementId, expectedOwnerUserId, actorUserId, mode } = params;
  const now = Date.now();
  const deleted: Record<string, number> = {};
  const eng = await ctx.db.get(engagementId);
  if (!eng) {
    return {
      phase: "done",
      hasMore: false,
      deleted,
      detached: 0,
      s3ObjectsQueued: 0,
      dryRun: mode === "dryRun",
    };
  }
  if (eng.user_id !== expectedOwnerUserId) {
    throw new ConvexError({
      code: "ACCESS_DENIED",
      message: "Engajamento sem acesso",
    });
  }

  const firstCall = !eng.hard_deleted_at;

  // ── P0: pré-condições + fence (só na 1ª chamada, antes de qualquer lápide) ──
  if (firstCall) {
    const reports = await ctx.db
      .query("reports")
      .withIndex("by_engagement", (q) => q.eq("engagement_id", engagementId))
      .take(REPORT_SCAN_CAP);
    if (reports.some((r) => r.status === "queued" || r.status === "rendering")) {
      throw new ConvexError({
        code: "HAS_INFLIGHT_REPORTS",
        message:
          "Há relatório em geração; aguarde terminar ou falhar antes de excluir.",
      });
    }
    const sched = await ctx.db
      .query("scheduled_assessments")
      .withIndex("by_engagement", (q) => q.eq("engagement_id", engagementId))
      .first();
    if (
      sched &&
      sched.status === "dispatching" &&
      (sched.claimed_at ?? 0) > now - SCHED_LEASE_MS
    ) {
      throw new ConvexError({
        code: "SCHEDULE_DISPATCHING",
        message:
          "Uma reavaliação está sendo despachada agora; tente de novo em instantes.",
      });
    }
    const chatsForRun = await ctx.db
      .query("chats")
      .withIndex("by_engagement_and_updated", (q) =>
        q.eq("engagement_id", engagementId),
      )
      .take(CHAT_SCAN_CAP);
    const liveRun = chatsForRun.find(
      (c) =>
        !!c.active_trigger_run_id &&
        !c.canceled_at &&
        (!c.last_run_finished_at || c.last_run_finished_at < c.update_time) &&
        c.update_time > now - RUN_STALE_MS,
    );
    if (liveRun) {
      throw new ConvexError({
        code: "HAS_ACTIVE_RUN",
        message:
          "Há um scan/run ativo neste engajamento; cancele ou aguarde terminar antes de excluir.",
      });
    }

    if (mode === "execute") {
      await ctx.db.patch(engagementId, {
        hard_deleted_at: now,
        scope: undefined,
        starts_at: undefined,
        ends_at: undefined,
        updated_at: now,
      });
      await ctx.db.insert("security_audit_log", {
        event_type: "engagement.hard_deleted",
        actor_user_id: actorUserId,
        actor_kind: "internal",
        organization_id: eng.organization_id,
        client_id: eng.client_id,
        engagement_id: engagementId,
        target_type: "engagement",
        target_id: String(engagementId),
        outcome: "success",
        detail: `Exclusão definitiva iniciada: ${eng.name}`.slice(0, 1000),
        created_at: now,
      });
      // 1:1 → a "tarefa" É a conversa do engajamento: apaga o chat INTEIRO
      // (mensagens/resumos/arquivos) reusando a deleção batcheada provada
      // (deleteChatForBackendBatch se auto-agenda p/ chats grandes). Multi-chat
      // → P7 só DESANEXA (preserva). D6 revisto com o William: a tarefa 1:1 some
      // junto com o engajamento (senão a lápide "volta" como tarefa no sidebar).
      const soleChats = await ctx.db
        .query("chats")
        .withIndex("by_engagement_and_updated", (q) =>
          q.eq("engagement_id", engagementId),
        )
        .take(2);
      if (soleChats.length === 1) {
        await ctx.scheduler.runAfter(
          0,
          internal.chats.deleteChatForBackendBatch,
          { chatId: soleChats[0].id, userId: soleChats[0].user_id },
        );
      }
    }
  }

  // No dry-run (não apaga nada) lemos MAIS por chamada p/ a prévia ficar COMPLETA
  // em engajamentos típicos (INNOVENT etc.). O teto de 16 MiB de leitura ainda
  // vale — um engajamento patológico estoura e falha FECHADO (sem preview → botão
  // de excluir travado) — e orçamento esgotado marca `partial`, então a prévia
  // nunca afirma "total" quando é parcial.
  const DRY = mode === "dryRun";
  const evBatch = DRY ? 100 : EV_BATCH;
  const findingBatch = DRY ? 40 : FINDING_BATCH;
  const reportBatch = DRY ? 150 : REPORT_BATCH;
  const genericBatch = DRY ? 200 : GENERIC_BATCH;
  const chatBatch = DRY ? 200 : CHAT_BATCH;
  const budget: ReadBudget = { remaining: DRY ? 700 : CALL_READ_BUDGET };
  let hasMore = false;
  let s3Queued = 0;
  let detached = 0;

  // ── P1: recorrência ──
  {
    const b = await collectByIndexBatch<Doc<"scheduled_assessments">>(
      ctx,
      budget,
      "scheduled_assessments",
      "by_engagement",
      (q) => q.eq("engagement_id", engagementId),
      genericBatch,
    );
    await deleteDocs(ctx, deleted, "scheduled_assessments", b.docs, mode);
    hasMore = hasMore || b.hasMore;
  }

  // ── P2: evidência (+ files órfãos + S3) ──
  if (budget.remaining > 1) {
    const b = await collectByIndexBatch<Doc<"evidence">>(
      ctx,
      budget,
      "evidence",
      "by_engagement_and_captured",
      (q) => q.eq("engagement_id", engagementId),
      evBatch,
    );
    // Planeja ANTES de apagar (usa o set de ids, não o estado do banco → seguro
    // independente da ordem). A seleção de chaves é pura + testada.
    const plan = await planEvidenceDeletion(ctx, b.docs, EVIDENCE_REF_SCAN_CAP);
    await deleteDocs(ctx, deleted, "evidence", b.docs, mode);
    for (const file of plan.filesToDelete) {
      increment(deleted, "files", 1);
      if (mode === "execute") {
        await fileCountAggregate.deleteIfExists(ctx, file);
        await ctx.db.delete(file._id);
      }
    }
    s3Queued += await enqueueS3DeleteBatch(ctx, plan.s3KeysToEnqueue, mode);
    hasMore = hasMore || b.hasMore;
  }

  // ── P3: achados ──
  if (budget.remaining > 1) {
    const b = await collectByIndexBatch<Doc<"findings">>(
      ctx,
      budget,
      "findings",
      "by_engagement_and_updated",
      (q) => q.eq("engagement_id", engagementId),
      findingBatch,
    );
    await deleteDocs(ctx, deleted, "findings", b.docs, mode);
    hasMore = hasMore || b.hasMore;
  }

  // ── P4: relatórios (hard-delete + S3). Acoplado à guarda do createReportRequest
  // (versão = max sobre as linhas → apagar sem a guarda reusaria versão entregue). ──
  if (budget.remaining > 1) {
    const b = await collectByIndexBatch<Doc<"reports">>(
      ctx,
      budget,
      "reports",
      "by_engagement",
      (q) => q.eq("engagement_id", engagementId),
      reportBatch,
    );
    const keys = b.docs
      .map((r) => r.s3_key)
      .filter((k): k is string => typeof k === "string" && k.length > 0);
    await deleteDocs(ctx, deleted, "reports", b.docs, mode);
    s3Queued += await enqueueS3DeleteBatch(ctx, keys, mode);
    hasMore = hasMore || b.hasMore;
  }

  // ── P5: orçamento ──
  if (budget.remaining > 1) {
    const b = await collectByIndexBatch<Doc<"engagement_budgets">>(
      ctx,
      budget,
      "engagement_budgets",
      "by_engagement",
      (q) => q.eq("engagement_id", engagementId),
      genericBatch,
    );
    await deleteDocs(ctx, deleted, "engagement_budgets", b.docs, mode);
    hasMore = hasMore || b.hasMore;
  }

  // ── P6: alertas de orçamento escopados ao engajamento ──
  if (budget.remaining > 1) {
    const b = await collectByIndexBatch<Doc<"budget_alerts">>(
      ctx,
      budget,
      "budget_alerts",
      "by_scope_key",
      (q) =>
        q.eq("scope", "engagement").eq("scope_id", String(engagementId)),
      genericBatch,
    );
    await deleteDocs(ctx, deleted, "budget_alerts", b.docs, mode);
    hasMore = hasMore || b.hasMore;
  }

  // ── P7: chats — DESANEXA + suppress (D6) ──
  if (budget.remaining > 1) {
    const b = await collectByIndexBatch<Doc<"chats">>(
      ctx,
      budget,
      "chats",
      "by_engagement_and_updated",
      (q) => q.eq("engagement_id", engagementId),
      chatBatch,
    );
    if (mode === "execute") {
      for (const c of b.docs) {
        await ctx.db.patch(c._id, {
          engagement_id: undefined,
          suppress_auto_engagement: true,
          update_time: now,
        });
      }
    }
    detached += b.docs.length;
    hasMore = hasMore || b.hasMore;
  }

  // Se o orçamento de leitura esgotou, alguma fase (guardada por
  // `budget.remaining > 1`) pode ter sido PULADA sem drenar — força outra
  // passada em vez de declarar "done" cedo (re-chamadas são idempotentes;
  // índices já drenados leem vazio). Sem isso, um engajamento grande poderia
  // encerrar com chats ainda anexados (P7) se P2–P6 consumissem o orçamento.
  if (budget.remaining <= 1) hasMore = true;

  // ── P8: finaliza (pós-auditoria durável) ──
  if (!hasMore && mode === "execute") {
    await ctx.db.insert("security_audit_log", {
      event_type: "engagement.hard_deleted",
      actor_user_id: actorUserId,
      actor_kind: "internal",
      organization_id: eng.organization_id,
      client_id: eng.client_id,
      engagement_id: engagementId,
      target_type: "engagement",
      target_id: String(engagementId),
      outcome: "success",
      detail: `Exclusão definitiva concluída: ${eng.name}`.slice(0, 1000),
      created_at: Date.now(),
    });
  }

  return {
    phase: hasMore ? "draining" : "done",
    hasMore,
    deleted,
    detached,
    s3ObjectsQueued: s3Queued,
    dryRun: mode === "dryRun",
  };
}
