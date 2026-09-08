import { NextRequest, NextResponse } from "next/server";
import { getConvexClient } from "@/lib/db/convex-client";
import { api } from "@/convex/_generated/api";
import { sendCampaign, normSegment } from "@/lib/marketing/dispatch";

export const runtime = "nodejs";

const MAX_PER_RUN = 20;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // sem segredo, o dispatcher fica fechado
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const headerSecret = req.headers.get("x-cron-secret") ?? "";
  return bearer === secret || headerSecret === secret;
}

async function run(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const serviceKey = process.env.CONVEX_SERVICE_ROLE_KEY;
  const apiKey = process.env.RESEND_API_KEY;
  if (!serviceKey || !apiKey) {
    return NextResponse.json(
      { error: "Server not configured" },
      { status: 500 },
    );
  }

  const convex = getConvexClient();
  const results: { subject: string; sent: number; failed: number }[] = [];

  for (let i = 0; i < MAX_PER_RUN; i++) {
    const claim = await convex.mutation(api.scheduledCampaigns.claimNextDue, {
      serviceKey,
    });
    if (!claim.found || !claim.id) break;

    try {
      const r = await sendCampaign(serviceKey, apiKey, {
        segment: normSegment(claim.segment),
        subject: claim.subject ?? "",
        body: claim.body ?? "",
        createdBy: "scheduler",
      });
      await convex.mutation(api.scheduledCampaigns.markResult, {
        serviceKey,
        id: claim.id,
        status: r.sent > 0 || r.total === 0 ? "sent" : "failed",
        total: r.total,
        sent: r.sent,
        failed: r.failed,
      });
      results.push({ subject: claim.subject ?? "", sent: r.sent, failed: r.failed });
    } catch (e) {
      await convex.mutation(api.scheduledCampaigns.markResult, {
        serviceKey,
        id: claim.id,
        status: "failed",
        total: 0,
        sent: 0,
        failed: 0,
      });
      results.push({
        subject: claim.subject ?? "",
        sent: 0,
        failed: -1,
      });
      console.error(
        "[dispatch-campaigns] falha",
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  return NextResponse.json({ processed: results.length, results });
}

export async function POST(req: NextRequest) {
  return run(req);
}
export async function GET(req: NextRequest) {
  return run(req);
}
