import { query } from "./_generated/server";
import { v } from "convex/values";
import { validateServiceKey } from "./lib/utils";
import { utcDay } from "./unitEconomicsLib";
import type { Id } from "./_generated/dataModel";

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
      firstActivityAt: v.union(v.number(), v.null()),
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
      firstActivityAt: number | null;
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
            firstActivityAt: null,
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
        if (
          agg.lastActivityAt === null ||
          r._creationTime > agg.lastActivityAt
        ) {
          agg.lastActivityAt = r._creationTime;
        }
        if (
          agg.firstActivityAt === null ||
          r._creationTime < agg.firstActivityAt
        ) {
          agg.firstActivityAt = r._creationTime;
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
        firstActivityAt: agg.firstActivityAt,
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
    firstActivityAt: v.union(v.number(), v.null()),
    lastActivityAt: v.union(v.number(), v.null()),
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
    let taskFirstAt: number | null = null;
    let taskLastAt: number | null = null;

    for (const r of rows) {
      if (userId === null) userId = r.user_id;
      if (taskFirstAt === null || r._creationTime < taskFirstAt) {
        taskFirstAt = r._creationTime;
      }
      if (taskLastAt === null || r._creationTime > taskLastAt) {
        taskLastAt = r._creationTime;
      }
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

    // Início EXATO da task: a linha mais antiga pode estar fora da janela de
    // DETAIL_ROW_CAP (que retém as mais recentes), então uma leitura O(1) pelo
    // índice by_chat em ordem crescente devolve o verdadeiro começo. O fim (mais
    // recente) já está garantido dentro da janela lida acima (taskLastAt). Assim
    // a duração da task no detalhe é sempre exata — nunca um limite inferior.
    const oldestRow = await ctx.db
      .query("usage_logs")
      .withIndex("by_chat", (q) => q.eq("chat_id", args.chatId))
      .order("asc")
      .first();
    const firstActivityAt = oldestRow?._creationTime ?? taskFirstAt;

    const byRunArr = Array.from(byRun.values())
      .sort((a, b) => b.at - a.at)
      .slice(0, 200);

    return {
      chatId: args.chatId,
      title: chat?.title ?? "(sem título)",
      userId,
      total,
      byModel: Array.from(byModel.values()).sort(
        (a, b) => b.costDollars - a.costDollars,
      ),
      byRun: byRunArr,
      firstActivityAt,
      lastActivityAt: taskLastAt,
      capped,
    };
  },
});

/**
 * Análise de custos por período (e opcionalmente por cliente) para o /admin.
 * Fonte: usage_logs (uma linha por request). Custo REAL =
 * provider_billed_cost_dollars (créditos do OpenRouter) com fallback para
 * cost_dollars; REGISTRADO = cost_dollars. Atribuição a cliente:
 * usage_logs.chat_id → chats.by_chat_id → engagement_id →
 * engagements.client_id → clients.name. Chats sem engajamento caem em
 * "Não atribuído". A janela é lida do índice de sistema by_creation_time (mais
 * novas primeiro); `capped` sinaliza quando o teto foi atingido (os totais
 * viram um limite inferior sobre as linhas mais recentes).
 */
const ANALYTICS_ROW_CAP = 8000;
const MAX_CHAT_LOOKUPS = 1500;
const TOP_MODELS = 30;
const TOP_USERS = 50;
const TOP_CLIENTS = 100;
const CLIENTS_LIST_CAP = 500;

const PERIOD_CFG: Record<string, { ms: number; bucketMs: number }> = {
  "1h": { ms: 60 * 60 * 1000, bucketMs: 5 * 60 * 1000 },
  "24h": { ms: 24 * 60 * 60 * 1000, bucketMs: 60 * 60 * 1000 },
  "7d": { ms: 7 * 24 * 60 * 60 * 1000, bucketMs: 24 * 60 * 60 * 1000 },
  "30d": { ms: 30 * 24 * 60 * 60 * 1000, bucketMs: 24 * 60 * 60 * 1000 },
  "90d": { ms: 90 * 24 * 60 * 60 * 1000, bucketMs: 7 * 24 * 60 * 60 * 1000 },
  "180d": { ms: 180 * 24 * 60 * 60 * 1000, bucketMs: 7 * 24 * 60 * 60 * 1000 },
  "365d": { ms: 365 * 24 * 60 * 60 * 1000, bucketMs: 30 * 24 * 60 * 60 * 1000 },
};

export const getCostAnalyticsForBackend = query({
  args: {
    serviceKey: v.string(),
    period: v.union(
      v.literal("1h"),
      v.literal("24h"),
      v.literal("7d"),
      v.literal("30d"),
      v.literal("90d"),
      v.literal("180d"),
      v.literal("365d"),
    ),
    clientId: v.optional(v.id("clients")),
    nowMs: v.number(),
  },
  returns: v.object({
    period: v.string(),
    from: v.number(),
    to: v.number(),
    bucketMs: v.number(),
    totals: v.object({
      realCost: v.number(),
      registeredCost: v.number(),
      requests: v.number(),
      inputTokens: v.number(),
      outputTokens: v.number(),
      realRows: v.number(),
    }),
    series: v.array(
      v.object({
        t: v.number(),
        realCost: v.number(),
        registeredCost: v.number(),
        requests: v.number(),
      }),
    ),
    byClient: v.array(
      v.object({
        clientId: v.union(v.id("clients"), v.null()),
        name: v.string(),
        realCost: v.number(),
        registeredCost: v.number(),
        requests: v.number(),
      }),
    ),
    byEngagement: v.array(
      v.object({
        engagementId: v.union(v.id("engagements"), v.null()),
        name: v.string(),
        clientName: v.string(),
        realCost: v.number(),
        registeredCost: v.number(),
        requests: v.number(),
      }),
    ),
    byModel: v.array(
      v.object({
        model: v.string(),
        realCost: v.number(),
        registeredCost: v.number(),
        requests: v.number(),
        inputTokens: v.number(),
        outputTokens: v.number(),
      }),
    ),
    byEndpoint: v.array(
      v.object({
        endpoint: v.string(),
        realCost: v.number(),
        requests: v.number(),
      }),
    ),
    byUser: v.array(
      v.object({
        userId: v.string(),
        realCost: v.number(),
        requests: v.number(),
        lastActivityAt: v.union(v.number(), v.null()),
      }),
    ),
    clients: v.array(
      v.object({
        id: v.id("clients"),
        name: v.string(),
        status: v.union(v.literal("active"), v.literal("archived")),
      }),
    ),
    capped: v.boolean(),
    scannedRows: v.number(),
  }),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const cfg = PERIOD_CFG[args.period];
    const to = args.nowMs;
    const from = to - cfg.ms;
    const bucketMs = cfg.bucketMs;
    const bucketCount = Math.max(1, Math.ceil(cfg.ms / bucketMs));

    // Janela de usage_logs (mais novas primeiro), limitada pelo teto.
    const rows = await ctx.db
      .query("usage_logs")
      .withIndex("by_creation_time", (q) => q.gte("_creationTime", from))
      .order("desc")
      .take(ANALYTICS_ROW_CAP);
    const capped = rows.length === ANALYTICS_ROW_CAP;

    // Resolve chat_id → cliente + engajamento (memo; teto de lookups distintos).
    type Owner = {
      id: Id<"clients"> | null;
      name: string;
      engId: Id<"engagements"> | null;
      engName: string;
    };
    const UNASSIGNED: Owner = {
      id: null,
      name: "Não atribuído",
      engId: null,
      engName: "Não atribuído",
    };
    const chatCache = new Map<string, Owner>();
    const clientNameCache = new Map<string, string>();
    let lookups = 0;
    const resolveClientForChat = async (
      chatId: string | undefined,
    ): Promise<Owner> => {
      if (!chatId) return UNASSIGNED;
      const cached = chatCache.get(chatId);
      if (cached) return cached;
      if (lookups >= MAX_CHAT_LOOKUPS) return UNASSIGNED;
      lookups++;
      const chat = await ctx.db
        .query("chats")
        .withIndex("by_chat_id", (q) => q.eq("id", chatId))
        .first();
      let out: Owner = UNASSIGNED;
      if (chat?.engagement_id) {
        const eng = await ctx.db.get(chat.engagement_id);
        if (eng) {
          const cid = eng.client_id;
          let name = clientNameCache.get(cid);
          if (name === undefined) {
            const client = await ctx.db.get(cid);
            name = client?.name ?? "Cliente removido";
            clientNameCache.set(cid, name);
          }
          out = {
            id: cid,
            name,
            engId: chat.engagement_id,
            engName: eng.name,
          };
        }
      }
      chatCache.set(chatId, out);
      return out;
    };

    const totals = {
      realCost: 0,
      registeredCost: 0,
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      realRows: 0,
    };
    const series = Array.from({ length: bucketCount }, (_, i) => ({
      t: from + i * bucketMs,
      realCost: 0,
      registeredCost: 0,
      requests: 0,
    }));
    const byClient = new Map<
      string,
      {
        clientId: Id<"clients"> | null;
        name: string;
        realCost: number;
        registeredCost: number;
        requests: number;
      }
    >();
    const byModel = new Map<
      string,
      {
        model: string;
        realCost: number;
        registeredCost: number;
        requests: number;
        inputTokens: number;
        outputTokens: number;
      }
    >();
    const byEndpoint = new Map<
      string,
      { endpoint: string; realCost: number; requests: number }
    >();
    const byEngagement = new Map<
      string,
      {
        engagementId: Id<"engagements"> | null;
        name: string;
        clientName: string;
        realCost: number;
        registeredCost: number;
        requests: number;
      }
    >();
    const byUser = new Map<
      string,
      {
        userId: string;
        realCost: number;
        requests: number;
        lastActivityAt: number | null;
      }
    >();

    for (const r of rows) {
      if (r._creationTime > to) continue;
      const client = await resolveClientForChat(r.chat_id);
      if (args.clientId && client.id !== args.clientId) continue;

      const hasReal = typeof r.provider_billed_cost_dollars === "number";
      const real = hasReal
        ? (r.provider_billed_cost_dollars as number)
        : r.cost_dollars;
      const reg = r.cost_dollars;
      const inTok = r.input_tokens;
      const outTok = r.output_tokens;

      totals.realCost += real;
      totals.registeredCost += reg;
      totals.requests += 1;
      totals.inputTokens += inTok;
      totals.outputTokens += outTok;
      if (hasReal) totals.realRows += 1;

      let bi = Math.floor((r._creationTime - from) / bucketMs);
      if (bi < 0) bi = 0;
      if (bi >= bucketCount) bi = bucketCount - 1;
      const s = series[bi];
      s.realCost += real;
      s.registeredCost += reg;
      s.requests += 1;

      const ckey = client.id ?? "__unassigned__";
      const cAgg = byClient.get(ckey) ?? {
        clientId: client.id,
        name: client.name,
        realCost: 0,
        registeredCost: 0,
        requests: 0,
      };
      cAgg.realCost += real;
      cAgg.registeredCost += reg;
      cAgg.requests += 1;
      byClient.set(ckey, cAgg);

      const engKey = client.engId ?? "__unassigned__";
      const eAggEng = byEngagement.get(engKey) ?? {
        engagementId: client.engId,
        name: client.engName,
        clientName: client.name,
        realCost: 0,
        registeredCost: 0,
        requests: 0,
      };
      eAggEng.realCost += real;
      eAggEng.registeredCost += reg;
      eAggEng.requests += 1;
      byEngagement.set(engKey, eAggEng);

      const mAgg = byModel.get(r.model) ?? {
        model: r.model,
        realCost: 0,
        registeredCost: 0,
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
      };
      mAgg.realCost += real;
      mAgg.registeredCost += reg;
      mAgg.requests += 1;
      mAgg.inputTokens += inTok;
      mAgg.outputTokens += outTok;
      byModel.set(r.model, mAgg);

      const ekey = r.endpoint ?? "—";
      const eAgg = byEndpoint.get(ekey) ?? {
        endpoint: ekey,
        realCost: 0,
        requests: 0,
      };
      eAgg.realCost += real;
      eAgg.requests += 1;
      byEndpoint.set(ekey, eAgg);

      const uAgg = byUser.get(r.user_id) ?? {
        userId: r.user_id,
        realCost: 0,
        requests: 0,
        lastActivityAt: null as number | null,
      };
      uAgg.realCost += real;
      uAgg.requests += 1;
      if (uAgg.lastActivityAt === null || r._creationTime > uAgg.lastActivityAt)
        uAgg.lastActivityAt = r._creationTime;
      byUser.set(r.user_id, uAgg);
    }

    // Lista de clientes para o seletor do painel.
    const clientDocs = await ctx.db.query("clients").take(CLIENTS_LIST_CAP);
    const clients = clientDocs
      .map((c) => ({ id: c._id, name: c.name, status: c.status }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const sortReal = (a: { realCost: number }, b: { realCost: number }) =>
      b.realCost - a.realCost;

    return {
      period: args.period,
      from,
      to,
      bucketMs,
      totals,
      series,
      byClient: Array.from(byClient.values())
        .sort(sortReal)
        .slice(0, TOP_CLIENTS),
      byEngagement: Array.from(byEngagement.values())
        .sort(sortReal)
        .slice(0, TOP_CLIENTS),
      byModel: Array.from(byModel.values()).sort(sortReal).slice(0, TOP_MODELS),
      byEndpoint: Array.from(byEndpoint.values()).sort(sortReal),
      byUser: Array.from(byUser.values()).sort(sortReal).slice(0, TOP_USERS),
      clients,
      capped,
      scannedRows: rows.length,
    };
  },
});

/**
 * Visão de negócio (receita/custo/lucro) por período, do rollup diário
 * `unit_economics_daily`. **Regra anti-dupla-contagem:** todo evento de uso
 * grava uma linha entity_type="user" (custo COMPLETO) e, se houver org, uma
 * linha "organization" que DUPLICA o custo. Então: CUSTO = só linhas "user";
 * RECEITA = "user" + "organization" (fluxos distintos: assinatura/extra
 * individual vs. de time — sem sobreposição). Requests/tokens = só "user".
 * MRR é snapshot → usa o do dia mais recente da janela. Fonte 100% indexada
 * (índice by_day), sem varrer usage_logs.
 */
const REV_ROW_CAP = 6000;
const DAY_MS = 24 * 60 * 60 * 1000;
const REV_PERIOD_CFG: Record<string, { ms: number; bucketDays: number }> = {
  "7d": { ms: 7 * DAY_MS, bucketDays: 1 },
  "30d": { ms: 30 * DAY_MS, bucketDays: 2 },
  "90d": { ms: 90 * DAY_MS, bucketDays: 7 },
  "180d": { ms: 180 * DAY_MS, bucketDays: 14 },
  "365d": { ms: 365 * DAY_MS, bucketDays: 30 },
};

export const getRevenueAnalyticsForBackend = query({
  args: {
    serviceKey: v.string(),
    period: v.union(
      v.literal("7d"),
      v.literal("30d"),
      v.literal("90d"),
      v.literal("180d"),
      v.literal("365d"),
    ),
    nowMs: v.number(),
  },
  returns: v.object({
    period: v.string(),
    fromDay: v.string(),
    toDay: v.string(),
    bucketDays: v.number(),
    totals: v.object({
      revenue: v.number(),
      revenueUser: v.number(),
      revenueOrg: v.number(),
      cost: v.number(),
      grossProfit: v.number(),
      marginPct: v.number(),
      mrr: v.number(),
      requests: v.number(),
      inputTokens: v.number(),
      outputTokens: v.number(),
    }),
    series: v.array(
      v.object({
        t: v.number(),
        revenue: v.number(),
        cost: v.number(),
        profit: v.number(),
      }),
    ),
    capped: v.boolean(),
    dayRows: v.number(),
  }),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const cfg = REV_PERIOD_CFG[args.period];
    const to = args.nowMs;
    const from = to - cfg.ms;
    const fromDay = utcDay(from);
    const toDay = utcDay(to);
    const bucketMs = cfg.bucketDays * DAY_MS;
    const fromDayMs = Date.parse(`${fromDay}T00:00:00.000Z`);
    const toDayMs = Date.parse(`${toDay}T00:00:00.000Z`);
    const bucketCount = Math.max(
      1,
      Math.floor((toDayMs - fromDayMs) / bucketMs) + 1,
    );

    const rows = await ctx.db
      .query("unit_economics_daily")
      .withIndex("by_day", (q) => q.gte("day", fromDay).lte("day", toDay))
      .take(REV_ROW_CAP);
    const capped = rows.length === REV_ROW_CAP;

    const series = Array.from({ length: bucketCount }, (_, i) => ({
      t: fromDayMs + i * bucketMs,
      revenue: 0,
      cost: 0,
      profit: 0,
    }));
    const dayMrr = new Map<string, number>();
    let revenueUser = 0;
    let revenueOrg = 0;
    let cost = 0;
    let requests = 0;
    let inputTokens = 0;
    let outputTokens = 0;

    for (const r of rows) {
      const dayMs = Date.parse(`${r.day}T00:00:00.000Z`);
      if (Number.isNaN(dayMs)) continue;
      let bi = Math.floor((dayMs - fromDayMs) / bucketMs);
      if (bi < 0) bi = 0;
      if (bi >= bucketCount) bi = bucketCount - 1;
      const s = series[bi];

      if (r.entity_type === "user") {
        cost += r.total_cost_dollars;
        revenueUser += r.net_revenue_dollars;
        requests += r.usage_request_count;
        inputTokens += r.input_tokens;
        outputTokens += r.output_tokens;
        s.cost += r.total_cost_dollars;
        s.revenue += r.net_revenue_dollars;
      } else {
        revenueOrg += r.net_revenue_dollars;
        s.revenue += r.net_revenue_dollars;
      }
      dayMrr.set(r.day, (dayMrr.get(r.day) ?? 0) + (r.mrr_dollars ?? 0));
    }

    for (const s of series) s.profit = s.revenue - s.cost;

    const revenue = revenueUser + revenueOrg;
    const grossProfit = revenue - cost;
    const marginPct = revenue > 0 ? (grossProfit / revenue) * 100 : 0;
    let mrr = 0;
    let latestDay = "";
    for (const [day, value] of dayMrr) {
      if (day > latestDay) {
        latestDay = day;
        mrr = value;
      }
    }

    return {
      period: args.period,
      fromDay,
      toDay,
      bucketDays: cfg.bucketDays,
      totals: {
        revenue,
        revenueUser,
        revenueOrg,
        cost,
        grossProfit,
        marginPct,
        mrr,
        requests,
        inputTokens,
        outputTokens,
      },
      series,
      capped,
      dayRows: rows.length,
    };
  },
});
