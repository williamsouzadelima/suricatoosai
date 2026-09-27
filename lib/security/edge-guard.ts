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
const MAX_TRACKED_IPS = 5000;
const SENSITIVE_PREFIXES = ["/api/admin", "/admin", "/api/portal"];

interface EdgeConfig {
  mode: string;
  autoBlock: boolean;
  reqWindowS: number;
  reqMax: number;
  denyMax: number;
  pathScanMax: number;
  ttlS: number;
}

let blockSet = new Set<string>();
let safeSet = new Set<string>();
let killSwitch = false;
let config: EdgeConfig = {
  mode: "shadow",
  autoBlock: false,
  reqWindowS: 60,
  reqMax: 600,
  denyMax: 40,
  pathScanMax: 25,
  ttlS: 3600,
};
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
      config = {
        mode: d.mode,
        autoBlock: d.autoBlock,
        reqWindowS: d.reqWindowS,
        reqMax: d.reqMax,
        denyMax: d.denyMax,
        pathScanMax: d.pathScanMax,
        ttlS: d.ttlS,
      };
    })
    .catch(() => {
      // fail-open: mantém o cache anterior (ou vazio)
    })
    .finally(() => {
      fetching = false;
      lastFetch = Date.now();
    });
}

interface Counter {
  reqCount: number;
  denyCount: number;
  paths: Set<string>;
  windowStart: number;
  flagged: boolean;
}
const counters = new Map<string, Counter>();

function evictOldest(): void {
  // Remove ~10% dos mais antigos para limitar memória.
  const drop = Math.max(1, Math.floor(counters.size * 0.1));
  const keys = counters.keys();
  for (let i = 0; i < drop; i++) {
    const k = keys.next().value;
    if (k === undefined) break;
    counters.delete(k);
  }
}

function fireThreat(
  ip: string,
  eventType: "threat.detected" | "enumeration.detected",
  detail: string,
  autoBlock: boolean,
): void {
  const serviceKey = process.env.CONVEX_SERVICE_ROLE_KEY;
  if (!serviceKey) return;
  getConvexClient()
    .mutation(api.security.recordThreatForBackend, {
      serviceKey,
      eventType,
      ip,
      detail,
      autoBlock,
      ttlSeconds: config.ttlS,
    })
    .catch(() => {});
}

/**
 * Observa um request para detecção (rajada de requisições/401, varredura de
 * paths sensíveis). In-memory, fail-open, dispara recordThreat só ao cruzar o
 * limiar (uma vez por janela por IP). NUNCA lança nem bloqueia o request aqui —
 * o bloqueio (quando em modo enforce + autoBlock) é aplicado pelo Convex e passa
 * a valer no próximo refresh do cache.
 */
export function observe(req: NextRequest, kind: "request" | "deny"): void {
  try {
    if (killSwitch) return;
    const ip = getClientIp(req);
    if (!ip || safeSet.has(ip)) return;
    const now = Date.now();
    const windowMs = Math.max(1, config.reqWindowS) * 1000;
    let c = counters.get(ip);
    if (!c || now - c.windowStart > windowMs) {
      c = {
        reqCount: 0,
        denyCount: 0,
        paths: new Set(),
        windowStart: now,
        flagged: false,
      };
      counters.set(ip, c);
      if (counters.size > MAX_TRACKED_IPS) evictOldest();
    }
    if (kind === "request") {
      c.reqCount += 1;
      const path = req.nextUrl.pathname;
      if (
        c.paths.size < 300 &&
        SENSITIVE_PREFIXES.some((p) => path.startsWith(p))
      ) {
        c.paths.add(path);
      }
    } else {
      c.denyCount += 1;
    }
    if (c.flagged) return;

    let detail = "";
    let eventType: "threat.detected" | "enumeration.detected" =
      "threat.detected";
    if (c.reqCount > config.reqMax) {
      detail = `rajada de requisições (${c.reqCount} em ${config.reqWindowS}s)`;
    } else if (c.denyCount > config.denyMax) {
      detail = `rajada de 401 (${c.denyCount} em ${config.reqWindowS}s)`;
      eventType = "enumeration.detected";
    } else if (c.paths.size > config.pathScanMax) {
      detail = `varredura de paths sensíveis (${c.paths.size} distintos)`;
      eventType = "enumeration.detected";
    }
    if (!detail) return;
    c.flagged = true;
    const autoBlock = config.mode === "enforce" && config.autoBlock;
    fireThreat(ip, eventType, detail, autoBlock);
  } catch {
    // fail-open
  }
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
