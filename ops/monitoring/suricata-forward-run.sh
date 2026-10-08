#!/usr/bin/env bash
# Wrapper do encaminhador do Suricata: faz source+strip da chave do env (mesma
# extração do healthcheck/deps-audit — o EnvironmentFile do systemd não limpa
# aspas/formatação), carrega o node via nvm, e roda `tail -F | node`.
set -uo pipefail

ENV_FILE="${MONITOR_ENV_FILE:-/etc/suricatoos-monitor.env}"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi
export CONVEX_SERVICE_KEY="$(printf '%s' "${CONVEX_SERVICE_KEY:-}" | tr -d '"'"'"' \t\r\n')"

export HOME="${HOME:-/root}"
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1090
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && nvm use 22.23.2 >/dev/null 2>&1

EVE="${SURICATA_EVE:-/var/log/suricata/eve.json}"
FWD="${SURICATA_FWD:-/root/suricatoos/ops/monitoring/suricata-forward.mjs}"
exec tail -F -n 0 "$EVE" | node "$FWD"
