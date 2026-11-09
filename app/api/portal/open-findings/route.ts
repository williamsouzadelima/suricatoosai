import { NextRequest, NextResponse } from "next/server";
import { getPortalSessionUser } from "@/lib/auth/require-portal";
import { getConvexClient } from "@/lib/db/convex-client";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { PortalOpenFindings } from "@/convex/lib/portalSummary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lista portfólio-inteiro de achados EM ABERTO ("Ver todos", Fase 1c). O Convex
// nega por padrão (membership) e devolve null → 404. Auditoria durável
// (fail-closed, view=open_list) ANTES de servir: sem gravação → 503, nunca serve.
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
  // Redige o serviceKey de qualquer erro logado (defesa-em-profundidade).
  const redact = (x: unknown) =>
    (x instanceof Error ? x.message : String(x))
      .split(serviceKey)
      .join("[REDACTED]");
  const convex = getConvexClient();
  const cid = clientId as Id<"clients">;
  let data: PortalOpenFindings | null = null;
  try {
    data = await convex.query(api.portal.listPortalOpenFindingsForBackend, {
      serviceKey,
      userId: u.id,
      clientId: cid,
      nowMs: Date.now(),
    });
  } catch (e) {
    console.error("portal open-findings: query falhou:", redact(e));
    return NextResponse.json({ error: "Lista indisponível" }, { status: 503 });
  }
  let auditOk = false;
  try {
    const audit = await convex.mutation(
      api.portal.recordPortalSummaryViewForBackend,
      {
        serviceKey,
        userId: u.id,
        clientId: cid,
        published: data?.items.length ?? 0,
        engagements: data?.total ?? 0,
        actorEmail: u.email ?? undefined,
        ip:
          req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
          undefined,
        userAgent: req.headers.get("user-agent") ?? undefined,
        view: "open_list",
      },
    );
    auditOk = audit.ok;
  } catch (e) {
    console.error("portal open-findings: auditoria indisponível:", redact(e));
    return NextResponse.json(
      { error: "Auditoria indisponível" },
      { status: 503 },
    );
  }
  if (data === null || !auditOk) {
    return NextResponse.json({ error: "Sem acesso" }, { status: 404 });
  }
  return NextResponse.json({ clientId, openFindings: data });
}
