// Encaminhador de alertas do Suricata → app. Lê linhas do eve.json (via
// `tail -F` no stdin), filtra SÓ alertas de alta severidade, dedup por
// assinatura+origem (evita spam), e POSTa em /api/internal/security-alert
// (que grava anomaly.detected + e-mail/Teams). Chave em CONVEX_SERVICE_KEY.
// Fail-open: qualquer erro por linha é ignorado (nunca derruba o encaminhador).
import readline from "node:readline";

const KEY = (process.env.CONVEX_SERVICE_KEY || "").trim();
const MIN_SEV = Number(process.env.SURICATA_MIN_SEVERITY || 1); // 1 = mais severo
const DEDUP_MS = Number(process.env.SURICATA_DEDUP_MS || 3600000); // 1h
const URL =
  process.env.SURICATA_ALERT_URL ||
  "http://localhost:3000/api/internal/security-alert";

if (!KEY) {
  console.error("[suricata-forward] sem CONVEX_SERVICE_KEY — nada a fazer");
  process.exit(0);
}

const seen = new Map(); // assinatura|origem -> ts do último envio

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  let e;
  try {
    e = JSON.parse(line);
  } catch {
    return;
  }
  if (!e || e.event_type !== "alert" || !e.alert) return;
  const sev = e.alert.severity ?? 3;
  if (sev > MIN_SEV) return;

  const sig = String(e.alert.signature || "?").slice(0, 160);
  const src = String(e.src_ip || "?");
  const k = sig + "|" + src;
  const now = Date.now();
  if (seen.has(k) && now - seen.get(k) < DEDUP_MS) return;
  seen.set(k, now);
  if (seen.size > 5000) {
    for (const [kk, t] of seen) if (now - t > DEDUP_MS) seen.delete(kk);
  }

  const detail = `[suricata] ${sig} (sev ${sev}) ${src} -> ${
    e.dest_ip || "?"
  }:${e.dest_port || "?"}`;
  fetch(URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-service-key": KEY },
    body: JSON.stringify({ detail, ip: src.slice(0, 64) }),
  }).catch(() => {});
});
