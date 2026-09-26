import { NextRequest, NextResponse } from "next/server";
import { getConvexClient } from "@/lib/db/convex-client";
import { api } from "@/convex/_generated/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Endpoint INTERNO para o encaminhador do Suricata (roda no host, posta em
 * localhost:3000). Gate por SERVICE KEY no header (NÃO é sessão) — self-gated,
 * mesmo estando em AUTHKIT_BYPASS_PATHS. Registra anomaly.detected e dispara a
 * notificação imediata pelo MESMO canal (Teams/e-mail de monitorSettings).
 * NÃO auto-bloqueia IP (alertas de IDS de rede são ruidosos para block automático).
 */
export async function POST(req: NextRequest) {
  const serviceKey = process.env.CONVEX_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return NextResponse.json({ error: "not configured" }, { status: 500 });
  }
  if (req.headers.get("x-service-key") !== serviceKey) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const detail =
    typeof body.detail === "string"
      ? body.detail.slice(0, 500)
      : "alerta de rede (Suricata)";
  const ip =
    typeof body.ip === "string" && body.ip.length <= 64 ? body.ip : undefined;
  try {
    await getConvexClient().mutation(api.security.recordThreatForBackend, {
      serviceKey,
      eventType: "anomaly.detected",
      ...(ip ? { ip } : {}),
      detail,
      autoBlock: false,
      ttlSeconds: 3600,
    });
  } catch (e) {
    console.error("security-alert: falha ao registrar", e);
    return NextResponse.json({ error: "record failed" }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
