import { query } from "./_generated/server";
import { v } from "convex/values";
import { validateServiceKey } from "./lib/utils";

/**
 * Per-user activity aggregation for the /admin panel (service-key gated).
 * Reads usage_logs by the `by_user` index. Aggregation is capped per user to
 * keep the query bounded; `capped` flags when the cap was hit (totals are then
 * a lower bound over the most recent rows).
 */

const PER_USER_ROW_CAP = 3000;
const MAX_USERS = 200;

export const getUsersActivity = query({
  args: {
    serviceKey: v.string(),
    userIds: v.array(v.string()),
  },
  returns: v.array(
    v.object({
      userId: v.string(),
      requests: v.number(),
      inputTokens: v.number(),
      outputTokens: v.number(),
      costDollars: v.number(),
      lastActivityAt: v.union(v.number(), v.null()),
      capped: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);

    const results: Array<{
      userId: string;
      requests: number;
      inputTokens: number;
      outputTokens: number;
      costDollars: number;
      lastActivityAt: number | null;
      capped: boolean;
    }> = [];

    for (const userId of args.userIds.slice(0, MAX_USERS)) {
      const rows = await ctx.db
        .query("usage_logs")
        .withIndex("by_user", (q) => q.eq("user_id", userId))
        .order("desc")
        .take(PER_USER_ROW_CAP);

      let inputTokens = 0;
      let outputTokens = 0;
      let costDollars = 0;
      let lastActivityAt: number | null = null;

      for (const r of rows) {
        inputTokens += r.input_tokens;
        outputTokens += r.output_tokens;
        costDollars += r.cost_dollars;
        if (lastActivityAt === null || r._creationTime > lastActivityAt) {
          lastActivityAt = r._creationTime;
        }
      }

      results.push({
        userId,
        requests: rows.length,
        inputTokens,
        outputTokens,
        costDollars,
        lastActivityAt,
        capped: rows.length === PER_USER_ROW_CAP,
      });
    }

    return results;
  },
});

/**
 * Per-task (per-chat) cost aggregation for the /admin panel (service-key gated).
 * A "task" is a chat; its cost is the sum of usage_logs rows sharing its
 * chat_id (which already include subagent + auto-continuation rows). Both the
 * registered cost (cost_dollars, upstream-preferred) and the real provider-billed
 * cost (provider_billed_cost_dollars, present only on rows written after that
 * field shipped) are surfaced so the two can be compared.
 */

const TASK_LIST_LIMIT = 500;
const DETAIL_ROW_CAP = 2000;

const COST_SOURCE_RANK: Record<string, number> = {
  raw_token_estimate: 0,
  token_estimate: 1,
  hybrid: 2,
  provider: 3,
};

/** Least-confident source across a task's rows (an estimate taints the whole). */
function worstCostSource(sources: Set<string>): string {
  let worst: string | null = null;
  let worstRank = Infinity;
  for (const s of sources) {
    const rank = COST_SOURCE_RANK[s] ?? 0;
    if (rank < worstRank) {
      worstRank = rank;
      worst = s;
    }
  }
  return worst ?? "unknown";
}

export const getTaskCosts = query({
  args: {
    serviceKey: v.string(),
    userIds: v.array(v.string()),
  },
  returns: v.array(
    v.object({
      chatId: v.union(v.string(), v.null()),
      title: v.string(),
      userId: v.string(),
      requests: v.number(),
      inputTokens: v.number(),
      outputTokens: v.number(),
      cacheReadTokens: v.number(),
      modelCostDollars: v.number(),
      nonModelCostDollars: v.number(),
      costDollars: v.number(),
      providerBilledCostDollars: v.number(),
      hasRealCost: v.boolean(),
      models: v.array(v.string()),
      costSource: v.string(),
      lastActivityAt: v.union(v.number(), v.null()),
      capped: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);

    type Agg = {
      chatId: string | null;
      userId: string;
      requests: number;
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      modelCostDollars: number;
      nonModelCostDollars: number;
      costDollars: number;
      providerBilledCostDollars: number;
      hasRealCost: boolean;
      models: Set<string>;
      costSources: Set<string>;
      lastActivityAt: number | null;
      capped: boolean;
    };

    const byChat = new Map<string, Agg>();

    for (const userId of args.userIds.slice(0, MAX_USERS)) {
      const rows = await ctx.db
        .query("usage_logs")
        .withIndex("by_user", (q) => q.eq("user_id", userId))
        .order("desc")
        .take(PER_USER_ROW_CAP);
      const capped = rows.length === PER_USER_ROW_CAP;

      for (const r of rows) {
        const chatId = r.chat_id ?? null;
        const key = `${userId}::${chatId ?? "__no_task__"}`;
        let agg = byChat.get(key);
        if (!agg) {
          agg = {
            chatId,
            userId,
            requests: 0,
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            modelCostDollars: 0,
            nonModelCostDollars: 0,
            costDollars: 0,
            providerBilledCostDollars: 0,
            hasRealCost: false,
            models: new Set(),
            costSources: new Set(),
            lastActivityAt: null,
            capped,
          };
          byChat.set(key, agg);
        }
        agg.requests += 1;
        agg.inputTokens += r.input_tokens;
        agg.outputTokens += r.output_tokens;
        agg.cacheReadTokens += r.cache_read_tokens ?? 0;
        agg.modelCostDollars += r.model_cost_dollars ?? 0;
        agg.nonModelCostDollars += r.non_model_cost_dollars ?? 0;
        agg.costDollars += r.cost_dollars;
        if (typeof r.provider_billed_cost_dollars === "number") {
          agg.providerBilledCostDollars += r.provider_billed_cost_dollars;
          agg.hasRealCost = true;
        }
        agg.models.add(r.model);
        if (r.cost_source) agg.costSources.add(r.cost_source);
        if (agg.lastActivityAt === null || r._creationTime > agg.lastActivityAt) {
          agg.lastActivityAt = r._creationTime;
        }
        agg.capped = agg.capped || capped;
      }
    }

    const aggs = Array.from(byChat.values());
    aggs.sort((a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0));
    const top = aggs.slice(0, TASK_LIST_LIMIT);

    // Join chat titles only for the tasks we return (bounds the lookups).
    const results = [];
    for (const agg of top) {
      let title = agg.chatId === null ? "(sem task)" : "(sem título)";
      if (agg.chatId !== null) {
        const chat = await ctx.db
          .query("chats")
          .withIndex("by_chat_id", (q) => q.eq("id", agg.chatId as string))
          .first();
        if (chat?.title) title = chat.title;
      }
      results.push({
        chatId: agg.chatId,
        title,
        userId: agg.userId,
        requests: agg.requests,
        inputTokens: agg.inputTokens,
        outputTokens: agg.outputTokens,
        cacheReadTokens: agg.cacheReadTokens,
        modelCostDollars: agg.modelCostDollars,
        nonModelCostDollars: agg.nonModelCostDollars,
        costDollars: agg.costDollars,
        providerBilledCostDollars: agg.providerBilledCostDollars,
        hasRealCost: agg.hasRealCost,
        models: Array.from(agg.models),
        costSource: worstCostSource(agg.costSources),
        lastActivityAt: agg.lastActivityAt,
        capped: agg.capped,
      });
    }

    return results;
  },
});

export const getTaskCostDetail = query({
  args: {
    serviceKey: v.string(),
    chatId: v.string(),
  },
  returns: v.object({
    chatId: v.string(),
    title: v.string(),
    userId: v.union(v.string(), v.null()),
    total: v.object({
      requests: v.number(),
      inputTokens: v.number(),
      outputTokens: v.number(),
      cacheReadTokens: v.number(),
      modelCostDollars: v.number(),
      nonModelCostDollars: v.number(),
      costDollars: v.number(),
      providerBilledCostDollars: v.number(),
      hasRealCost: v.boolean(),
    }),
    byModel: v.array(
      v.object({
        model: v.string(),
        requests: v.number(),
        inputTokens: v.number(),
        outputTokens: v.number(),
        cacheReadTokens: v.number(),
        costDollars: v.number(),
        providerBilledCostDollars: v.number(),
        hasRealCost: v.boolean(),
      }),
    ),
    byRun: v.array(
      v.object({
        runId: v.string(),
        model: v.string(),
        endpoint: v.union(v.string(), v.null()),
        at: v.number(),
        inputTokens: v.number(),
        outputTokens: v.number(),
        cacheReadTokens: v.number(),
        costDollars: v.number(),
        providerBilledCostDollars: v.number(),
        hasRealCost: v.boolean(),
      }),
    ),
    capped: v.boolean(),
  }),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);

    const rows = await ctx.db
      .query("usage_logs")
      .withIndex("by_chat", (q) => q.eq("chat_id", args.chatId))
      .order("desc")
      .take(DETAIL_ROW_CAP);
    const capped = rows.length === DETAIL_ROW_CAP;

    const total = {
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      modelCostDollars: 0,
      nonModelCostDollars: 0,
      costDollars: 0,
      providerBilledCostDollars: 0,
      hasRealCost: false,
    };

    type ModelAgg = {
      model: string;
      requests: number;
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      costDollars: number;
      providerBilledCostDollars: number;
      hasRealCost: boolean;
    };
    const byModel = new Map<string, ModelAgg>();

    type RunAgg = {
      runId: string;
      model: string;
      endpoint: string | null;
      at: number;
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      costDollars: number;
      providerBilledCostDollars: number;
      hasRealCost: boolean;
    };
    const byRun = new Map<string, RunAgg>();

    let userId: string | null = null;

    for (const r of rows) {
      if (userId === null) userId = r.user_id;
      const real =
        typeof r.provider_billed_cost_dollars === "number"
          ? r.provider_billed_cost_dollars
          : 0;
      const hasReal = typeof r.provider_billed_cost_dollars === "number";

      total.requests += 1;
      total.inputTokens += r.input_tokens;
      total.outputTokens += r.output_tokens;
      total.cacheReadTokens += r.cache_read_tokens ?? 0;
      total.modelCostDollars += r.model_cost_dollars ?? 0;
      total.nonModelCostDollars += r.non_model_cost_dollars ?? 0;
      total.costDollars += r.cost_dollars;
      total.providerBilledCostDollars += real;
      total.hasRealCost = total.hasRealCost || hasReal;

      const m = byModel.get(r.model) ?? {
        model: r.model,
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        costDollars: 0,
        providerBilledCostDollars: 0,
        hasRealCost: false,
      };
      m.requests += 1;
      m.inputTokens += r.input_tokens;
      m.outputTokens += r.output_tokens;
      m.cacheReadTokens += r.cache_read_tokens ?? 0;
      m.costDollars += r.cost_dollars;
      m.providerBilledCostDollars += real;
      m.hasRealCost = m.hasRealCost || hasReal;
      byModel.set(r.model, m);

      const runId = r.assistant_message_id ?? r.usage_settlement_id ?? r._id;
      const run = byRun.get(runId) ?? {
        runId,
        model: r.model,
        endpoint: r.endpoint ?? null,
        at: r._creationTime,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        costDollars: 0,
        providerBilledCostDollars: 0,
        hasRealCost: false,
      };
      run.inputTokens += r.input_tokens;
      run.outputTokens += r.output_tokens;
      run.cacheReadTokens += r.cache_read_tokens ?? 0;
      run.costDollars += r.cost_dollars;
      run.providerBilledCostDollars += real;
      run.hasRealCost = run.hasRealCost || hasReal;
      if (r._creationTime > run.at) run.at = r._creationTime;
      byRun.set(runId, run);
    }

    const chat = await ctx.db
      .query("chats")
      .withIndex("by_chat_id", (q) => q.eq("id", args.chatId))
      .first();

    const byRunArr = Array.from(byRun.values()).sort((a, b) => b.at - a.at);

    return {
      chatId: args.chatId,
      title: chat?.title ?? "(sem título)",
      userId,
      total,
      byModel: Array.from(byModel.values()).sort(
        (a, b) => b.costDollars - a.costDollars,
      ),
      byRun: byRunArr.slice(0, 200),
      capped,
    };
  },
});
