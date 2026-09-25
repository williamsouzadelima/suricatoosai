import { query } from "./_generated/server";
import { v } from "convex/values";
import { validateServiceKey } from "./lib/utils";

// TEMPORÁRIO — diagnóstico do estado de engajamentos/achados/evidência.
export const engagementState = query({
  args: { serviceKey: v.string() },
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const engs = await ctx.db.query("engagements").order("desc").take(12);
    const out = [];
    for (const e of engs) {
      const findings = await ctx.db
        .query("findings")
        .withIndex("by_engagement_and_updated", (q) =>
          q.eq("engagement_id", e._id),
        )
        .collect();
      const byStatus: Record<string, number> = {};
      let ev = 0;
      let imgs = 0;
      let withS3 = 0;
      for (const f of findings) {
        byStatus[f.status] = (byStatus[f.status] ?? 0) + 1;
        const es = await ctx.db
          .query("evidence")
          .withIndex("by_finding_and_captured", (q) =>
            q.eq("finding_id", f._id),
          )
          .collect();
        ev += es.length;
        imgs += es.filter((x) => x.file_id).length;
        withS3 += es.filter((x) => x.s3_key).length;
      }
      out.push({
        engagement: e.name,
        id: e._id,
        user_id: e.user_id.slice(0, 12),
        findings: findings.length,
        byStatus,
        evidenceTotal: ev,
        evidenceWithFileId: imgs,
        evidenceWithS3: withS3,
      });
    }
    return out;
  },
});
