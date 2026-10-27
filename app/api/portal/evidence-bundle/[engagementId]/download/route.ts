import { NextRequest, NextResponse } from "next/server";
import { getPortalSessionUser } from "@/lib/auth/require-portal";
import { getConvexClient } from "@/lib/db/convex-client";
import { getS3Client } from "@/convex/s3Utils";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { verifyStepUpToken, STEP_UP_COOKIE } from "@/lib/mfa/step-up-token";
import { consumeStepUpJti } from "@/lib/mfa/single-use";
import { buildEvidenceBundleStream } from "@/lib/evidence/bundle";
import { buildEvidenceBundleFilename } from "@/lib/reports/report-filename";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Download do bundle .tar.gz de TODA a evidência do engajamento (CLIENTE/portal).
 * Paridade total com o operador (sem filtro de status). Exige step-up MFA (cookie
 * escopado) + uso único + MEMBERSHIP ativa (resolveMembership) + auditoria
 * fail-closed (actorKind "client") ANTES dos bytes. Streama on-the-fly.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ engagementId: string }> },
) {
  const { engagementId } = await params;
  const u = await getPortalSessionUser();
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const serviceKey = process.env.CONVEX_SERVICE_ROLE_KEY;
  const bucket = process.env.AWS_S3_BUCKET_NAME;
  if (!serviceKey || !bucket) {
    return NextResponse.json({ error: "Server not configured" }, { status: 500 });
  }

  const userId = u.id;
  const actorEmail = u.email ?? undefined;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const userAgent = req.headers.get("user-agent") ?? undefined;
  const engId = engagementId as Id<"engagements">;

  // 1) Autorização de step-up (cookie) + bind (ator "client").
  let jti: string;
  let exp: number;
  try {
    const claims = await verifyStepUpToken(
      req.cookies.get(STEP_UP_COOKIE)?.value,
      { userId, engagementId, actorKind: "client" },
    );
    jti = claims.jti;
    exp = claims.exp;
  } catch {
    return NextResponse.json({ error: "step_up_required" }, { status: 401 });
  }

  // 2) Uso único.
  const once = await consumeStepUpJti(jti, exp);
  if (once === "unavailable") {
    return NextResponse.json({ error: "single_use_unavailable" }, { status: 503 });
  }
  if (once === "reused") {
    return NextResponse.json({ error: "authorization_reused" }, { status: 401 });
  }

  const convex = getConvexClient();

  // 3) Tenancy (membership) + nome do engajamento.
  const first = await convex.query(
    api.portal.listAllEvidenceForEngagementPagePortalForBackend,
    { serviceKey, userId, engagementId: engId, cursor: null, numItems: 400 },
  );
  if (first.denied) {
    try {
      await convex.mutation(api.securityAudit.recordSecurityEventForBackend, {
        serviceKey,
        eventType: "access.denied",
        actorUserId: userId,
        actorEmail,
        actorKind: "client",
        engagementId: engId,
        targetType: "evidence_bundle",
        targetId: engagementId,
        ip,
        userAgent,
        outcome: "denied",
        detail: "no_membership",
      });
    } catch (e) {
      console.error("portal evidence-bundle: auditar negacao falhou", e);
    }
    return NextResponse.json({ error: "Engajamento indisponivel" }, { status: 404 });
  }

  // 4) Auditoria fail-closed ANTES dos bytes.
  try {
    await convex.mutation(api.securityAudit.recordSecurityEventForBackend, {
      serviceKey,
      eventType: "evidence.downloaded",
      actorUserId: userId,
      actorEmail,
      actorKind: "client",
      engagementId: engId,
      targetType: "evidence_bundle",
      targetId: engagementId,
      ip,
      userAgent,
      outcome: "success",
      detail: "bundle .tar.gz (portal)",
    });
  } catch (e) {
    console.error("portal evidence-bundle: auditoria indisponivel, recusando", e);
    return NextResponse.json({ error: "Auditoria indisponivel" }, { status: 503 });
  }

  // 5) Streama o tar.gz on-the-fly.
  const generatedAt = Date.now();
  const engName = first.engagementName ?? "Evidencias";
  const stream = buildEvidenceBundleStream({
    s3: getS3Client(),
    bucket,
    engagementName: engName,
    generatedAt,
    fetchPage: async (cursor) => {
      const r = await convex.query(
        api.portal.listAllEvidenceForEngagementPagePortalForBackend,
        { serviceKey, userId, engagementId: engId, cursor, numItems: 400 },
      );
      return {
        denied: r.denied,
        page: r.page,
        isDone: r.isDone,
        continueCursor: r.continueCursor,
      };
    },
  });
  const filename = buildEvidenceBundleFilename({
    engagementName: engName,
    generatedAt,
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/gzip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
      "Set-Cookie": `${STEP_UP_COOKIE}=; Path=/api/portal/evidence-bundle/${engagementId}/download; Max-Age=0; HttpOnly; Secure; SameSite=Strict`,
    },
  });
}
