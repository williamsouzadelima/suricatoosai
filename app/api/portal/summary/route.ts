import { NextRequest, NextResponse } from "next/server";
import { getPortalSessionUser } from "@/lib/auth/require-portal";
import { getConvexClient } from "@/lib/db/convex-client";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Resumo de portfólio do cliente (Fase 1b). O Convex nega por padrão (membership)
// e devolve null nesse caso. Auditoria durável (fail-closed) ANTES de servir.
export async function GET(req: NextRequest) {
  const u = await getPortalSessionUser();
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const serviceKey = process.env.CONVEX_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return NextResponse.json(
      { error: "Server not configured" },
      { status: 500 },
    );
  }
  const clientId = new URL(req.url).searchParams.get("clientId");
  if (!clientId) {
    return NextResponse.json({ error: "clientId ausente" }, { status: 400 });
  }
  const convex = getConvexClient();
  const cid = clientId as Id<"clients">;
  const summary = await convex.query(api.portal.listPortalSummaryForBackend, {
    serviceKey,
    userId: u.id,
    clientId: cid,
    nowMs: Date.now(),
  });
  // Auditoria durável (fail-closed): registra a visualização do resumo (ou a
  // negação) antes de responder. Sem gravação → 503, nunca serve.
  let auditOk = false;
  try {
    const audit = await convex.mutation(
      api.portal.recordPortalSummaryViewForBackend,
      {
        serviceKey,
        userId: u.id,
        clientId: cid,
        published: summary?.findings.published ?? 0,
        engagements: summary?.engagements.total ?? 0,
        actorEmail: u.email ?? undefined,
        ip:
          req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
          undefined,
        userAgent: req.headers.get("user-agent") ?? undefined,
      },
    );
    auditOk = audit.ok;
  } catch (e) {
    console.error("portal summary: auditoria indisponível, recusando", e);
    return NextResponse.json(
      { error: "Auditoria indisponível" },
      { status: 503 },
    );
  }
  // null = sem acesso no momento da query; !auditOk = membership revogada ENTRE a
  // query e a auditoria. Qualquer um → 404 (nunca serve o resumo sem acesso
  // vigente). Eco do clientId deixa o cliente descartar respostas obsoletas.
  if (summary === null || !auditOk) {
    return NextResponse.json({ error: "Sem acesso" }, { status: 404 });
  }
  return NextResponse.json({ clientId, summary });
}
