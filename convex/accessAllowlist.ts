import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { validateServiceKey } from "./lib/utils";

/**
 * Invite-only access allowlist.
 *
 * A user's email is on the allowlist with one of:
 *  - "invited": added by a superadmin, has not signed in yet
 *  - "active":  has signed in at least once
 *  - "revoked": access removed by a superadmin
 *
 * The invite-only gate (Next callback) treats "invited" and "active" as allowed.
 * All functions are protected by the Convex service key, mirroring
 * convex/accountIdentities.ts.
 */

const statusValidator = v.union(
  v.literal("invited"),
  v.literal("active"),
  v.literal("revoked"),
);

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

export const isAllowed = query({
  args: {
    serviceKey: v.string(),
    email: v.string(),
  },
  returns: v.object({
    allowed: v.boolean(),
    status: v.optional(statusValidator),
  }),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);

    const email = normalizeEmail(args.email);
    if (!email) return { allowed: false };

    const entry = await ctx.db
      .query("access_allowlist")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();

    if (!entry) return { allowed: false };
    return {
      allowed: entry.status === "invited" || entry.status === "active",
      status: entry.status,
    };
  },
});

export const markActive = mutation({
  args: {
    serviceKey: v.string(),
    email: v.string(),
    nowMs: v.optional(v.number()),
  },
  // `promoted` is true only on the login that flips invited -> active (once),
  // so callers can fire a one-time welcome email.
  returns: v.object({ promoted: v.boolean() }),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);

    const email = normalizeEmail(args.email);
    if (!email) return { promoted: false };
    const now = args.nowMs ?? Date.now();

    const entry = await ctx.db
      .query("access_allowlist")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();

    // Only promote an already-allowed entry. Never create/activate a revoked
    // or missing entry — that is the gate's job, not this bookkeeping call.
    if (entry && entry.status === "invited") {
      await ctx.db.patch(entry._id, { status: "active", activated_at: now });
      return { promoted: true };
    }
    return { promoted: false };
  },
});

export const addInvite = mutation({
  args: {
    serviceKey: v.string(),
    email: v.string(),
    invitedBy: v.optional(v.string()),
    note: v.optional(v.string()),
    nowMs: v.optional(v.number()),
  },
  // status is v.string() (not the union) here to keep tsc's handler-type
  // inference under the complexity cutoff that a union-typed return field
  // trips against the large generated DataModel (TS2719).
  returns: v.object({ created: v.boolean(), status: v.string() }),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);

    const email = normalizeEmail(args.email);
    if (!email) throw new Error("Email is required");
    const now = args.nowMs ?? Date.now();

    const entry = await ctx.db
      .query("access_allowlist")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();

    if (entry) {
      // Re-inviting a revoked user restores access as "invited". An already
      // invited/active user is left untouched (idempotent).
      if (entry.status === "revoked") {
        // Leave any stale revoked_at as-is: access is governed by `status`
        // only (see isAllowed), and clearing it here trips a duplicate-convex
        // type edge (two convex versions in the tree).
        await ctx.db.patch(entry._id, {
          status: "invited",
          invited_by: args.invitedBy,
          invited_at: now,
          note: args.note ?? entry.note,
        });
        return { created: false, status: "invited" };
      }
      return { created: false, status: entry.status };
    }

    await ctx.db.insert("access_allowlist", {
      email,
      status: "invited",
      invited_by: args.invitedBy,
      invited_at: now,
      note: args.note,
    });
    return { created: true, status: "invited" };
  },
});

export const revoke = mutation({
  args: {
    serviceKey: v.string(),
    email: v.string(),
    nowMs: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);

    const email = normalizeEmail(args.email);
    if (!email) return null;
    const now = args.nowMs ?? Date.now();

    const entry = await ctx.db
      .query("access_allowlist")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();

    if (entry && entry.status !== "revoked") {
      await ctx.db.patch(entry._id, { status: "revoked", revoked_at: now });
    }
    return null;
  },
});

export const list = query({
  args: {
    serviceKey: v.string(),
    status: v.optional(statusValidator),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      email: v.string(),
      status: statusValidator,
      invited_by: v.optional(v.string()),
      invited_at: v.number(),
      activated_at: v.optional(v.number()),
      revoked_at: v.optional(v.number()),
      note: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);

    const limit = Math.min(args.limit ?? 500, 2000);
    const rows = args.status
      ? await ctx.db
          .query("access_allowlist")
          .withIndex("by_status", (q) => q.eq("status", args.status!))
          .take(limit)
      : await ctx.db.query("access_allowlist").take(limit);

    return rows.map((r) => ({
      email: r.email,
      status: r.status,
      invited_by: r.invited_by,
      invited_at: r.invited_at,
      activated_at: r.activated_at,
      revoked_at: r.revoked_at,
      note: r.note,
    }));
  },
});

/**
 * Bulk grandfather existing users as "active". Idempotent: emails already on
 * the allowlist are skipped. Used once before enabling INVITE_ONLY_ENABLED so
 * no current user loses access.
 */
export const backfillActive = mutation({
  args: {
    serviceKey: v.string(),
    emails: v.array(v.string()),
    invitedBy: v.optional(v.string()),
    nowMs: v.optional(v.number()),
  },
  returns: v.object({ inserted: v.number(), skipped: v.number() }),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const now = args.nowMs ?? Date.now();

    let inserted = 0;
    let skipped = 0;
    for (const raw of args.emails) {
      const email = normalizeEmail(raw);
      if (!email) {
        skipped++;
        continue;
      }
      const existing = await ctx.db
        .query("access_allowlist")
        .withIndex("by_email", (q) => q.eq("email", email))
        .unique();
      if (existing) {
        skipped++;
        continue;
      }
      await ctx.db.insert("access_allowlist", {
        email,
        status: "active",
        invited_by: args.invitedBy ?? "backfill",
        invited_at: now,
        activated_at: now,
      });
      inserted++;
    }
    return { inserted, skipped };
  },
});
