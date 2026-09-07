#!/usr/bin/env bash
#
# Suricatoos health monitor — checa site + Convex + serviços + RAM/disco e
# alerta APENAS na mudança de estado (cai / volta), evitando spam.
#
# Rodado pelo systemd timer suricatoos-monitor.timer (ver arquivos ao lado).
# Config/segredos em /etc/suricatoos-monitor.env (chmod 600, fora do git).
#
# Canais de alerta suportados (detecção automática pelo que estiver setado):
#   - Telegram: TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID
#   - Resend (e-mail): RESEND_API_KEY + ALERT_EMAIL_FROM + ALERT_EMAIL_TO
#
set -uo pipefail

ENV_FILE="${MONITOR_ENV_FILE:-/etc/suricatoos-monitor.env}"
# shellcheck disable=SC1090
[ -f "$ENV_FILE" ] && . "$ENV_FILE"

# ---- Config (com defaults) --------------------------------------------------
SITE_URL="${SITE_URL:-https://ai.suricatoos.com}"
CONVEX_URL="${CONVEX_URL:-https://dutiful-sheep-343.convex.cloud}"
CONVEX_QUERY_PATH="${CONVEX_QUERY_PATH:-referrals:getUnreadRewardNotifications}"
SERVICES="${SERVICES:-suricatoos-next suricatoos-trigger suricatoos-connector caddy centrifugo}"
MIN_AVAIL_MB="${MIN_AVAIL_MB:-150}"
MAX_DISK_PCT="${MAX_DISK_PCT:-90}"
CURL_TIMEOUT="${CURL_TIMEOUT:-10}"
STATE_DIR="${STATE_DIR:-/var/lib/suricatoos-monitor}"
LOG_FILE="${LOG_FILE:-/var/log/suricatoos-monitor.log}"
HEARTBEAT_HOUR="${HEARTBEAT_HOUR:-9}"   # hora local p/ heartbeat diário "tudo ok" (vazio = desliga)
HOSTLABEL="${HOSTLABEL:-$(hostname)}"

STATE_FILE="$STATE_DIR/failing"          # chaves atualmente com falha (1 por linha)
HEARTBEAT_STAMP="$STATE_DIR/last_heartbeat_day"
mkdir -p "$STATE_DIR"

ts() { date "+%Y-%m-%d %H:%M:%S %z"; }
log() { echo "[$(ts)] $*" >> "$LOG_FILE" 2>/dev/null || true; }

# ---- Coleta de falhas -------------------------------------------------------
# Cada falha vira uma linha "CHAVE\tMensagem legível".
FAILS=""       # chaves (1 por linha)
DETAILS=""     # "CHAVE: detalhe" (1 por linha)

add_fail() { # <chave> <detalhe>
  FAILS+="$1"$'\n'
  DETAILS+="$1: $2"$'\n'
}

# 1) Site responde 200
code=$(curl -sS -m "$CURL_TIMEOUT" -o /dev/null -w '%{http_code}' \
  -H 'Accept: text/html' "$SITE_URL/" 2>/dev/null || echo "000")
[ "$code" = "200" ] || add_fail "site" "GET $SITE_URL/ -> HTTP $code (esperado 200)"

# 2) Convex executa função (pega o cenário 'deployment desabilitado' de hoje)
cvx=$(curl -sS -m "$CURL_TIMEOUT" -X POST "$CONVEX_URL/api/query" \
  -H 'Content-Type: application/json' \
  -d "{\"path\":\"$CONVEX_QUERY_PATH\",\"args\":{},\"format\":\"json\"}" 2>/dev/null || echo "")
if ! printf '%s' "$cvx" | grep -q '"status":"success"'; then
  reason="sem resposta"
  printf '%s' "$cvx" | grep -qi 'exceeded the free plan' && reason="LIMITE DO PLANO estourado (deployment desabilitado)"
  printf '%s' "$cvx" | grep -qi 'Server Error' && [ "$reason" = "sem resposta" ] && reason="Server Error (função não executa)"
  add_fail "convex" "$CONVEX_QUERY_PATH -> $reason"
fi

# 3) Serviços systemd ativos
for svc in $SERVICES; do
  st=$(systemctl is-active "$svc" 2>/dev/null || echo "unknown")
  [ "$st" = "active" ] || add_fail "svc:$svc" "systemd $svc está '$st'"
done

# 4) RAM disponível
avail=$(free -m 2>/dev/null | awk '/^Mem:/{print $7}')
if [ -n "${avail:-}" ] && [ "$avail" -lt "$MIN_AVAIL_MB" ]; then
  add_fail "mem" "RAM disponível ${avail}MB < ${MIN_AVAIL_MB}MB"
fi

# 5) Disco em /
diskpct=$(df -P / 2>/dev/null | awk 'NR==2{gsub("%","",$5);print $5}')
if [ -n "${diskpct:-}" ] && [ "$diskpct" -gt "$MAX_DISK_PCT" ]; then
  add_fail "disk" "disco / em ${diskpct}% (> ${MAX_DISK_PCT}%)"
fi

CUR_FAILS=$(printf '%s' "$FAILS" | sed '/^$/d' | sort)
PREV_FAILS=$([ -f "$STATE_FILE" ] && sort "$STATE_FILE" || true)

# ---- Alertas ----------------------------------------------------------------
send_alert() { # <assunto> <corpo>
  local subject="$1" body="$2"
  if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ]; then
    curl -sS -m 15 -o /dev/null \
      "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \
      --data-urlencode "text=${subject}

${body}" \
      --data "disable_web_page_preview=true" \
      && log "alerta enviado (telegram): $subject" \
      || log "FALHA ao enviar alerta telegram: $subject"
  elif [ -n "${RESEND_API_KEY:-}" ] && [ -n "${ALERT_EMAIL_FROM:-}" ] && [ -n "${ALERT_EMAIL_TO:-}" ]; then
    local json
    json=$(printf '{"from":"%s","to":["%s"],"subject":"%s","text":"%s"}' \
      "$ALERT_EMAIL_FROM" "$ALERT_EMAIL_TO" \
      "$(printf '%s' "$subject" | sed 's/"/\\"/g')" \
      "$(printf '%s' "$body" | sed ':a;N;$!ba;s/\n/\\n/g;s/"/\\"/g')")
    curl -sS -m 15 -o /dev/null -X POST "https://api.resend.com/emails" \
      -H "Authorization: Bearer ${RESEND_API_KEY}" \
      -H "Content-Type: application/json" -d "$json" \
      && log "alerta enviado (resend): $subject" \
      || log "FALHA ao enviar alerta resend: $subject"
  else
    log "NENHUM canal de alerta configurado — alerta suprimido: $subject"
  fi
}

# --test envia um alerta de teste e sai
if [ "${1:-}" = "--test" ]; then
  send_alert "🔧 [$HOSTLABEL] Teste do monitor Suricatoos" \
    "Se você recebeu isto, o canal de alerta está funcionando. $(ts)"
  echo "teste enviado (ver $LOG_FILE)"
  exit 0
fi

newly_down=$(comm -23 <(printf '%s\n' "$CUR_FAILS" | sed '/^$/d') <(printf '%s\n' "$PREV_FAILS" | sed '/^$/d'))
recovered=$(comm -13 <(printf '%s\n' "$CUR_FAILS" | sed '/^$/d') <(printf '%s\n' "$PREV_FAILS" | sed '/^$/d'))

if [ -n "$CUR_FAILS" ]; then
  log "FALHANDO: $(printf '%s' "$CUR_FAILS" | tr '\n' ' ')"
else
  log "ok"
fi

if [ -n "$newly_down" ]; then
  send_alert "🔴 [$HOSTLABEL] Suricatoos com problema" \
"Novas falhas detectadas em $(ts):

$(printf '%s' "$DETAILS" | sed '/^$/d')

Falhas ativas: $(printf '%s' "$CUR_FAILS" | tr '\n' ' ')"
fi

if [ -n "$recovered" ]; then
  still=$([ -n "$CUR_FAILS" ] && printf 'Ainda com falha: %s' "$(printf '%s' "$CUR_FAILS" | tr '\n' ' ')" || printf 'Tudo normal novamente. ✅')
  send_alert "🟢 [$HOSTLABEL] Suricatoos recuperado" \
"Recuperado em $(ts): $(printf '%s' "$recovered" | tr '\n' ' ')

$still"
fi

# Heartbeat diário "tudo ok" (confirma que o monitor está vivo)
if [ -n "$HEARTBEAT_HOUR" ] && [ -z "$CUR_FAILS" ]; then
  today=$(date +%Y-%m-%d)
  hour=$(date +%-H)
  last=$([ -f "$HEARTBEAT_STAMP" ] && cat "$HEARTBEAT_STAMP" || echo "")
  if [ "$hour" = "$HEARTBEAT_HOUR" ] && [ "$last" != "$today" ]; then
    send_alert "✅ [$HOSTLABEL] Suricatoos saudável" \
      "Checagem diária: site + Convex + serviços + recursos OK. $(ts)"
    echo "$today" > "$HEARTBEAT_STAMP"
  fi
fi

# Persiste estado
printf '%s\n' "$CUR_FAILS" | sed '/^$/d' > "$STATE_FILE"
exit 0
