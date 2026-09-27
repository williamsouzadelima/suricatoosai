#!/usr/bin/env node
// Imprime o nº de relatórios presos (queued/rendering há > STUCK_MS). Usado pelo
// watchdog do trigger (scripts/trigger-watchdog.sh). Só leitura; serviceKey.
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
const serviceKey = process.env.CONVEX_SERVICE_ROLE_KEY;
const olderThanMs = Number(process.env.STUCK_MS || 6 * 60 * 1000);

if (!url || !serviceKey) {
  console.error(
    "count-stuck-reports: faltam NEXT_PUBLIC_CONVEX_URL/CONVEX_SERVICE_ROLE_KEY",
  );
  process.exit(2);
}

try {
  const client = new ConvexHttpClient(url);
  const n = await client.query(api.reports.countStuckReportsForBackend, {
    serviceKey,
    olderThanMs,
  });
  process.stdout.write(String(n));
} catch (e) {
  console.error("count-stuck-reports: consulta falhou:", e?.message || e);
  process.exit(3);
}
