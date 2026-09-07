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
