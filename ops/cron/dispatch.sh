#!/usr/bin/env bash
#
# Dispara o endpoint que processa campanhas de e-mail agendadas vencidas.
# Rodado pelo systemd timer suricatoos-dispatch.timer (a cada ~2 min).
# Lê o CRON_SECRET do .env.local do app (mesmo valor que o Next valida) e
# chama o endpoint em localhost (dentro do host — não passa por Caddy/WorkOS).
#
set -uo pipefail

ENV_FILE="${DISPATCH_ENV_FILE:-/root/suricatoos/.env.local}"
SECRET=$(grep CRON_SECRET= "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- | tr -d "\"' \t\r\n")
[ -z "$SECRET" ] && exit 0

curl -sS -m 60 -X POST \
  -H "Authorization: Bearer $SECRET" \
  http://localhost:3000/api/cron/dispatch-campaigns >/dev/null 2>&1 || true
