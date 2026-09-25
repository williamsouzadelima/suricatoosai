#!/usr/bin/env bash
# Watchdog do worker do trigger (modo `trigger dev` no host).
#
# Problema: a conexão websocket do worker com a nuvem do Trigger.dev pode morrer
# em silêncio — o processo continua "active" no systemd (Restart=on-failure não
# ajuda), mas para de processar tarefas → relatórios ficam "Na fila" sem run.
#
# Este script REINICIA o worker SOMENTE quando:
#   1) há relatório preso (queued/rendering há > 6 min), E
#   2) o worker não processou nenhum relatório nos últimos 8 min (mudo), E
#   3) NÃO há agent-long (pentest) em voo — nunca reiniciar no meio de um pentest.
# Em qualquer incerteza, NÃO reinicia (falha para o lado seguro).
#
# Instalado via systemd timer (a cada 5 min). Ver ops/ ou o runbook.

set -uo pipefail
cd /root/suricatoos || exit 0
export NVM_DIR="/root/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm use 22 >/dev/null 2>&1 || true

# Extrai só as duas variáveis necessárias (não faz `source` do .env inteiro).
readvar() {
  grep -hE "^$1=" .env.local .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"'"'"' '
}
URL="$(readvar NEXT_PUBLIC_CONVEX_URL)"
SVC="$(readvar CONVEX_SERVICE_ROLE_KEY)"
if [ -z "$URL" ] || [ -z "$SVC" ]; then
  exit 0
fi

# 1) Há relatório preso?
STUCK="$(NEXT_PUBLIC_CONVEX_URL="$URL" CONVEX_SERVICE_ROLE_KEY="$SVC" STUCK_MS=360000 \
  node scripts/count-stuck-reports.mjs 2>/dev/null)"
[[ "$STUCK" =~ ^[0-9]+$ ]] || exit 0   # consulta falhou → não age
[ "$STUCK" -eq 0 ] && exit 0            # nada preso → saudável

# 2) Worker processou relatório nos últimos 8 min? Então está vivo (só lento).
if journalctl -u suricatoos-trigger --since "-8 min" --no-pager 2>/dev/null \
  | grep -q "generate-engagement-report"; then
  exit 0
fi

# 3) agent-long (pentest) em voo? (run iniciado sem linha terminal na janela de 5h)
INFLIGHT="$(journalctl -u suricatoos-trigger --since "-5 h" --no-pager 2>/dev/null \
  | grep "agent-long" | grep -oE "run_[a-z0-9]+" | sort | uniq -c \
  | awk '$1<2{print $2}' | head -1)"
[ -n "$INFLIGHT" ] && exit 0            # pentest possivelmente em voo → não mexe

# Worker mudo, com relatório preso e sem pentest em voo → reinicia.
systemctl restart suricatoos-trigger
logger -t trigger-watchdog "worker mudo: $STUCK relatorio(s) preso(s) sem run -> reiniciado"
