import { getConvexClient } from "@/lib/db/convex-client";
import { api } from "@/convex/_generated/api";
import { isSuperadmin } from "@/lib/auth/superadmin";
import { getInternalRole } from "@/lib/auth/internal-roles";

/**
 * Detector de USUÁRIO autenticado atacante (negações repetidas em rotas
 * privilegiadas — getSuperadminUser/getInternalUser negando um usuário logado
 * que não é staff). Roda no processo Node (guards). In-memory, fail-open,
 * fire-and-forget. STAFF (superadmin/analista) NUNCA é contado nem suspenso.
 * A auto-suspensão real (modo enforce) é decidida no Convex; aqui só sinaliza.
 */

const REFRESH_MS = 30_000;
const MAX_TRACKED = 5000;

interface Cfg {
  mode: string;
  autoSuspend: boolean;
  windowS: number;
  threshold: number;
}
let cfg: Cfg = {
  mode: "shadow",
  autoSuspend: false,
  windowS: 60,
  threshold: 10,
};
let lastFetch = 0;
let fetching = false;

function refresh(): void {
  if (fetching) return;
  const serviceKey = process.env.CONVEX_SERVICE_ROLE_KEY;
  if (!serviceKey) return;
  fetching = true;
  getConvexClient()
    .query(api.security.getSecuritySettingsForBackend, { serviceKey })
    .then((s) => {
      cfg = {
        mode: s.enforcement_mode,
        autoSuspend: s.auto_suspend_users,
        windowS: s.req_burst_window_s,
        // Limiar de negações privilegiadas: fração do deny_burst, piso 8.
        threshold: Math.max(8, Math.ceil(s.deny_burst_max / 4)),
      };
    })
    .catch(() => {})
    .finally(() => {
      fetching = false;
      lastFetch = Date.now();
    });
}

const counters = new Map<
  string,
  { count: number; windowStart: number; flagged: boolean }
>();

function evictOldest(): void {
  const drop = Math.max(1, Math.floor(counters.size * 0.1));
  const keys = counters.keys();
  for (let i = 0; i < drop; i++) {
    const k = keys.next().value;
    if (k === undefined) break;
    counters.delete(k);
  }
}

/**
 * Registra uma negação de rota privilegiada para um usuário AUTENTICADO. Chamado
 * (fire-and-forget) pelos guards quando negam um usuário que existe mas não tem
 * acesso. NUNCA lança.
 */
export function recordUserDenial(
  userId: string | undefined | null,
  email: string | undefined | null,
): void {
  try {
    if (!userId) return;
    // Safe-list de staff: nunca contar nem suspender superadmin/analista.
    if (email && (isSuperadmin(email) || getInternalRole(email) !== null)) {
      return;
    }
    if (Date.now() - lastFetch > REFRESH_MS) {
      lastFetch = Date.now();
      refresh();
    }
    const now = Date.now();
    const windowMs = Math.max(1, cfg.windowS) * 1000;
    let c = counters.get(userId);
    if (!c || now - c.windowStart > windowMs) {
      c = { count: 0, windowStart: now, flagged: false };
      counters.set(userId, c);
      if (counters.size > MAX_TRACKED) evictOldest();
    }
    c.count += 1;
    if (c.flagged || c.count <= cfg.threshold) return;
    c.flagged = true;

    const serviceKey = process.env.CONVEX_SERVICE_ROLE_KEY;
    if (!serviceKey) return;
    const autoSuspend = cfg.mode === "enforce" && cfg.autoSuspend;
    getConvexClient()
      .mutation(api.security.recordUserThreatForBackend, {
        serviceKey,
        userId,
        email: email ?? undefined,
        detail: `negações repetidas em rota privilegiada (${c.count} em ${cfg.windowS}s)`,
        autoSuspend,
      })
      .catch(() => {});
  } catch {
    // fail-open
  }
}
