import { NextResponse, type NextRequest } from "next/server";
import { getConvexClient } from "@/lib/db/convex-client";
import { api } from "@/convex/_generated/api";

/**
 * Guarda de segurança da BORDA (chamada do proxy.ts/middleware, edge runtime).
 *
 * Projeto à prova de outage:
 * - **Fail-open:** qualquer erro → deixa passar (try/catch em tudo).
 * - **Não-bloqueante:** o snapshot da blocklist é lido do Convex em SEGUNDO
 *   PLANO (nunca `await` no caminho do request). Requisições usam o cache em
 *   memória; um IP recém-bloqueado propaga em até ~REFRESH_MS.
 * - **Sem dependência dura:** sem Redis; cache em escopo de módulo (processo
 *   único do `next start`). Kill-switch e safe-list vêm no mesmo snapshot.
 *
 * NÃO confiar em X-Forwarded-For cru sem `trusted_proxies` no Caddy (spoofável)
 * — por isso há safe-list e o enforcement é conservador.
 */

const REFRESH_MS = 30_000;

let blockSet = new Set<string>();
let safeSet = new Set<string>();
let killSwitch = false;
let lastFetch = 0;
let fetching = false;

function refreshInBackground(): void {
  if (fetching) return;
  const serviceKey = process.env.CONVEX_SERVICE_ROLE_KEY;
  if (!serviceKey) return;
  fetching = true;
  getConvexClient()
    .query(api.security.getEdgeBlocklistForBackend, { serviceKey })
    .then((d) => {
      blockSet = new Set(d.blocked);
      safeSet = new Set(d.safelist);
      killSwitch = d.killSwitch;
    })
    .catch(() => {
      // fail-open: mantém o cache anterior (ou vazio)
    })
    .finally(() => {
      fetching = false;
      lastFetch = Date.now();
    });
}

export function getClientIp(req: NextRequest): string | null {
  const xri = req.headers.get("x-real-ip");
  if (xri) return xri.trim();
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return null;
}

/**
 * Retorna 403 se o IP do request está bloqueado (e não na safe-list); senão
 * null. Dispara o refresh do cache em segundo plano. NUNCA lança.
 */
export function checkIpBlock(req: NextRequest): NextResponse | null {
  try {
    if (Date.now() - lastFetch > REFRESH_MS) {
      // Debounce: marca já para concorrentes não dispararem juntos.
      lastFetch = Date.now();
      refreshInBackground();
    }
    if (killSwitch) return null;
    if (blockSet.size === 0) return null;
    const ip = getClientIp(req);
    if (!ip || safeSet.has(ip)) return null;
    if (blockSet.has(ip)) {
      return NextResponse.json(
        { error: "forbidden", code: "ip_blocked" },
        { status: 403 },
      );
    }
    return null;
  } catch {
    return null; // fail-open
  }
}
