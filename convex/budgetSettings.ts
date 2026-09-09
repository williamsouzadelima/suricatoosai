import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { validateServiceKey } from "./lib/utils";

/**
 * Fase 4: config de orçamento de gasto (por task e por usuário). Doc único
 * key="global" + overrides por usuário. Gerenciado pelo /admin (service-key).
 * Defaults CONSERVADORES: desligado, e quando ligado nasce alerta-only.
 */

const KEY = "global";

const periodValidator = v.union(v.literal("day"), v.literal("month"));

const settingsShape = v.object({
  enabled: v.boolean(),
  per_task_enabled: v.boolean(),
  per_task_cap_dollars: v.optional(v.number()),
  per_task_block: v.boolean(),
  per_user_enabled: v.boolean(),
  per_user_cap_dollars: v.optional(v.number()),
  per_user_period: periodValidator,
  per_user_block: v.boolean(),
  warn_threshold_pct: v.optional(v.number()),
  alert_teams: v.boolean(),
  alert_email: v.boolean(),
  updated_by: v.optional(v.string()),
  updated_at: v.optional(v.number()),
});

const DEFAULTS = {
  enabled: false,
  per_task_enabled: false,
  per_task_cap_dollars: undefined as number | undefined,
  per_task_block: false,
  per_user_enabled: false,
  per_user_cap_dollars: undefined as number | undefined,
  per_user_period: "month" as const,
  per_user_block: false,
  warn_threshold_pct: 80,
  alert_teams: false,
  alert_email: false,
};

const overrideShape = v.object({
  user_id: v.string(),
  email: v.optional(v.string()),
  per_task_cap_dollars: v.optional(v.number()),
  per_user_cap_dollars: v.optional(v.number()),
  disabled: v.optional(v.boolean()),
  note: v.optional(v.string()),
  updated_by: v.optional(v.string()),
  updated_at: v.optional(v.number()),
});

export const get = query({
  args: { serviceKey: v.string() },
  returns: settingsShape,
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const row = await ctx.db
      .query("budget_settings")
      .withIndex("by_key", (q) => q.eq("key", KEY))
      .unique();
    if (!row) return { ...DEFAULTS };
    return {
      enabled: row.enabled,
      per_task_enabled: row.per_task_enabled,
      per_task_cap_dollars: row.per_task_cap_dollars,
      per_task_block: row.per_task_block,
      per_user_enabled: row.per_user_enabled,
      per_user_cap_dollars: row.per_user_cap_dollars,
      per_user_period: row.per_user_period,
      per_user_block: row.per_user_block,
      warn_threshold_pct: row.warn_threshold_pct,
      alert_teams: row.alert_teams,
      alert_email: row.alert_email,
      updated_by: row.updated_by,
      updated_at: row.updated_at,
    };
  },
});

export const update = mutation({
  args: {
    serviceKey: v.string(),
    enabled: v.boolean(),
    per_task_enabled: v.boolean(),
    per_task_cap_dollars: v.optional(v.number()),
    per_task_block: v.boolean(),
    per_user_enabled: v.boolean(),
    per_user_cap_dollars: v.optional(v.number()),
    per_user_period: periodValidator,
    per_user_block: v.boolean(),
    warn_threshold_pct: v.optional(v.number()),
    alert_teams: v.boolean(),
    alert_email: v.boolean(),
    updatedBy: v.optional(v.string()),
    nowMs: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const now = args.nowMs ?? Date.now();
    const row = await ctx.db
      .query("budget_settings")
      .withIndex("by_key", (q) => q.eq("key", KEY))
      .unique();
    const doc = {
      key: KEY,
      enabled: args.enabled,
      per_task_enabled: args.per_task_enabled,
      per_task_cap_dollars: args.per_task_cap_dollars,
      per_task_block: args.per_task_block,
      per_user_enabled: args.per_user_enabled,
      per_user_cap_dollars: args.per_user_cap_dollars,
      per_user_period: args.per_user_period,
      per_user_block: args.per_user_block,
      warn_threshold_pct: args.warn_threshold_pct,
      alert_teams: args.alert_teams,
      alert_email: args.alert_email,
      updated_by: args.updatedBy,
      updated_at: now,
    };
    if (row) await ctx.db.patch(row._id, doc);
    else await ctx.db.insert("budget_settings", doc);
    return null;
  },
});

/**
 * Config efetiva para UM usuário (global + override mesclados). É o ÚNICO read
 * que o runtime faz por run. enabled=false quando o master está off ou o usuário
 * está isento (override.disabled) → runtime vira no-op (nem consulta usage_logs).
 */
export const getEffectiveForUser = query({
  args: { serviceKey: v.string(), userId: v.string() },
  returns: v.object({
    enabled: v.boolean(),
    perTaskEnabled: v.boolean(),
    perTaskCapDollars: v.union(v.number(), v.null()),
    perTaskBlock: v.boolean(),
    perUserEnabled: v.boolean(),
    perUserCapDollars: v.union(v.number(), v.null()),
    perUserPeriod: periodValidator,
    perUserBlock: v.boolean(),
    warnThresholdPct: v.number(),
    alertTeams: v.boolean(),
    alertEmail: v.boolean(),
  }),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const NOOP = {
      enabled: false,
      perTaskEnabled: false,
      perTaskCapDollars: null,
      perTaskBlock: false,
      perUserEnabled: false,
      perUserCapDollars: null,
      perUserPeriod: "month" as const,
      perUserBlock: false,
      warnThresholdPct: 80,
      alertTeams: false,
      alertEmail: false,
    };

    const row = await ctx.db
      .query("budget_settings")
      .withIndex("by_key", (q) => q.eq("key", KEY))
      .unique();
    if (!row || !row.enabled) return NOOP;

    const override = await ctx.db
      .query("budget_user_overrides")
      .withIndex("by_user_id", (q) => q.eq("user_id", args.userId))
      .unique();
    if (override?.disabled) return NOOP;

    const perTaskCap =
      override?.per_task_cap_dollars ?? row.per_task_cap_dollars ?? null;
    const perUserCap =
      override?.per_user_cap_dollars ?? row.per_user_cap_dollars ?? null;

    return {
      enabled: true,
      perTaskEnabled: row.per_task_enabled && perTaskCap !== null,
      perTaskCapDollars: perTaskCap,
      perTaskBlock: row.per_task_block,
      perUserEnabled: row.per_user_enabled && perUserCap !== null,
      perUserCapDollars: perUserCap,
      perUserPeriod: row.per_user_period,
      perUserBlock: row.per_user_block,
      warnThresholdPct: row.warn_threshold_pct ?? 80,
      alertTeams: row.alert_teams,
      alertEmail: row.alert_email,
    };
  },
});

export const listOverrides = query({
  args: { serviceKey: v.string() },
  returns: v.array(overrideShape),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const rows = await ctx.db.query("budget_user_overrides").take(500);
    return rows.map((r) => ({
      user_id: r.user_id,
      email: r.email,
      per_task_cap_dollars: r.per_task_cap_dollars,
      per_user_cap_dollars: r.per_user_cap_dollars,
      disabled: r.disabled,
      note: r.note,
      updated_by: r.updated_by,
      updated_at: r.updated_at,
    }));
  },
});

export const upsertUserOverride = mutation({
  args: {
    serviceKey: v.string(),
    userId: v.string(),
    email: v.optional(v.string()),
    perTaskCapDollars: v.optional(v.number()),
    perUserCapDollars: v.optional(v.number()),
    disabled: v.optional(v.boolean()),
    note: v.optional(v.string()),
    updatedBy: v.optional(v.string()),
    nowMs: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const now = args.nowMs ?? Date.now();
    const existing = await ctx.db
      .query("budget_user_overrides")
      .withIndex("by_user_id", (q) => q.eq("user_id", args.userId))
      .unique();
    const doc = {
      user_id: args.userId,
      email: args.email,
      per_task_cap_dollars: args.perTaskCapDollars,
      per_user_cap_dollars: args.perUserCapDollars,
      disabled: args.disabled,
      note: args.note,
      updated_by: args.updatedBy,
      updated_at: now,
    };
    if (existing) await ctx.db.patch(existing._id, doc);
    else await ctx.db.insert("budget_user_overrides", doc);
    return null;
  },
});

export const removeUserOverride = mutation({
  args: { serviceKey: v.string(), userId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const existing = await ctx.db
      .query("budget_user_overrides")
      .withIndex("by_user_id", (q) => q.eq("user_id", args.userId))
      .unique();
    if (existing) await ctx.db.delete(existing._id);
    return null;
  },
});
