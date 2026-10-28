#!/usr/bin/env bash
#
# Dispara o endpoint que processa as reavaliacoes agendadas (recorrencia)
# vencidas. Rodado pelo systemd timer suricatoos-reassess.timer (de hora em
# hora — recorrencia de dias nao precisa de cadencia curta). Le o CRON_SECRET
# do .env.local do app (mesmo valor que o Next valida) e chama o endpoint em
# localhost (dentro do host — nao passa por Caddy/WorkOS). Cada ciclo so cria
# RASCUNHOS (chat vinculado + prompt semeado); NUNCA dispara o agente.
#
set -uo pipefail

ENV_FILE="${DISPATCH_ENV_FILE:-/root/suricatoos/.env.local}"
SECRET=$(grep CRON_SECRET= "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- | tr -d "\"' \t\r\n")
[ -z "$SECRET" ] && exit 0

curl -sS -m 60 -X POST \
  -H "Authorization: Bearer $SECRET" \
  http://localhost:3000/api/cron/dispatch-reassessments >/dev/null 2>&1 || true
