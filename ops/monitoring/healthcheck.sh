#!/usr/bin/env bash
#
# Suricatoos health monitor — checa site + Convex + serviços + RAM/disco e
# alerta APENAS na mudança de estado (cai / volta), evitando spam.
#
# Config dos canais (Teams / e-mail) vem do Convex (gerenciada pelo /admin) e é
# CACHEADA localmente — assim o monitor ainda alerta quando o Convex está fora
# (exatamente o cenário do incidente de 2026-09-07).
#
# Segredos de servidor ficam em /etc/suricatoos-monitor.env (chmod 600):
#   CONVEX_SERVICE_KEY  — para ler a config no Convex
#   RESEND_API_KEY      — para enviar e-mail (canal e-mail)
# A URL do webhook do Teams e o destinatário do e-mail vêm do Convex (/admin).
#
set -uo pipefail

ENV_FILE="${MONITOR_ENV_FILE:-/etc/suricatoos-monitor.env}"
# shellcheck disable=SC1090
[ -f "$ENV_FILE" ] && . "$ENV_FILE"

# ---- Config (com defaults) --------------------------------------------------
SITE_URL="${SITE_URL:-https://ai.suricatoos.com}"
CONVEX_URL="${CONVEX_URL:-https://dutiful-sheep-343.convex.cloud}"
CONVEX_QUERY_PATH="${CONVEX_QUERY_PATH:-referrals:getUnreadRewardNotifications}"
CONVEX_SERVICE_KEY="${CONVEX_SERVICE_KEY:-}"
RESEND_API_KEY="${RESEND_API_KEY:-}"
ALERT_EMAIL_FROM="${ALERT_EMAIL_FROM:-Suricatoos Alertas <alertas@suricatoos.com>}"
SERVICES="${SERVICES:-suricatoos-next suricatoos-trigger suricatoos-connector caddy centrifugo}"
MIN_AVAIL_MB="${MIN_AVAIL_MB:-150}"
MAX_DISK_PCT="${MAX_DISK_PCT:-90}"
CURL_TIMEOUT="${CURL_TIMEOUT:-10}"
STATE_DIR="${STATE_DIR:-/var/lib/suricatoos-monitor}"
LOG_FILE="${LOG_FILE:-/var/log/suricatoos-monitor.log}"
HEARTBEAT_HOUR="${HEARTBEAT_HOUR:-9}"   # hora local p/ heartbeat diário "tudo ok" (vazio = desliga)
HOSTLABEL="${HOSTLABEL:-$(hostname)}"

STATE_FILE="$STATE_DIR/failing"
HEARTBEAT_STAMP="$STATE_DIR/last_heartbeat_day"
CHANNELS_CACHE="$STATE_DIR/channels"     # config de canais espelhada do Convex
mkdir -p "$STATE_DIR"

ts() { date "+%Y-%m-%d %H:%M:%S %z"; }
log() { echo "[$(ts)] $*" >> "$LOG_FILE" 2>/dev/null || true; }

json_escape() {
  # escapa aspas/barras/quebras p/ um valor JSON. python3 (presente no Kali) com
  # fallback em sed.
  printf '%s' "$1" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read())[1:-1])' 2>/dev/null \
    || printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g' | sed ':a;N;$!ba;s/\n/\\n/g'
}

# ---- Canais (do Convex, com cache local) ------------------------------------
TEAMS_ENABLED=0; TEAMS_WEBHOOK_URL=""; EMAIL_ENABLED=0; EMAIL_TO=""

load_channels() {
  local resp
  if [ -n "$CONVEX_SERVICE_KEY" ]; then
    resp=$(curl -sS -m "$CURL_TIMEOUT" -X POST "$CONVEX_URL/api/query" \
      -H 'Content-Type: application/json' \
      -d "{\"path\":\"monitorSettings:get\",\"args\":{\"serviceKey\":\"$CONVEX_SERVICE_KEY\"},\"format\":\"json\"}" 2>/dev/null || echo "")
    if printf '%s' "$resp" | grep -q '"status":"success"'; then
      local te ee turl eto
      printf '%s' "$resp" | grep -q '"teams_enabled":true' && te=1 || te=0
      printf '%s' "$resp" | grep -q '"email_enabled":true' && ee=1 || ee=0
      turl=$(printf '%s' "$resp" | sed -n 's/.*"teams_webhook_url":"\([^"]*\)".*/\1/p')
      eto=$(printf '%s' "$resp"  | sed -n 's/.*"email_to":"\([^"]*\)".*/\1/p')
      { echo "TEAMS_ENABLED=$te"; echo "TEAMS_WEBHOOK_URL=$turl"
        echo "EMAIL_ENABLED=$ee"; echo "EMAIL_TO=$eto"; } > "$CHANNELS_CACHE"
    fi
  fi
  # Carrega do cache (fresco ou o último conhecido — resiliente a Convex fora).
  # Lê por sed (não faz `source`) p/ não interpretar & ? = da URL do webhook.
  if [ -f "$CHANNELS_CACHE" ]; then
    TEAMS_ENABLED=$(sed -n 's/^TEAMS_ENABLED=//p' "$CHANNELS_CACHE")
    TEAMS_WEBHOOK_URL=$(sed -n 's/^TEAMS_WEBHOOK_URL=//p' "$CHANNELS_CACHE")
    EMAIL_ENABLED=$(sed -n 's/^EMAIL_ENABLED=//p' "$CHANNELS_CACHE")
    EMAIL_TO=$(sed -n 's/^EMAIL_TO=//p' "$CHANNELS_CACHE")
  fi
}

send_alert() { # <assunto> <corpo>
  local subject="$1" body="$2" sent=0
  if [ "${TEAMS_ENABLED:-0}" = "1" ] && [ -n "${TEAMS_WEBHOOK_URL:-}" ]; then
    curl -sS -m 15 -o /dev/null -X POST "$TEAMS_WEBHOOK_URL" \
      -H 'Content-Type: application/json' \
      --data "$(printf '{"text":"**%s**\\n\\n%s"}' "$(json_escape "$subject")" "$(json_escape "$body")")" \
      && { log "alerta enviado (teams): $subject"; sent=1; } \
      || log "FALHA alerta teams: $subject"
  fi
  if [ "${EMAIL_ENABLED:-0}" = "1" ] && [ -n "${EMAIL_TO:-}" ] && [ -n "${RESEND_API_KEY:-}" ]; then
    curl -sS -m 15 -o /dev/null -X POST "https://api.resend.com/emails" \
      -H "Authorization: Bearer ${RESEND_API_KEY}" -H "Content-Type: application/json" \
      --data "$(printf '{"from":"%s","to":["%s"],"subject":"%s","text":"%s"}' \
        "$(json_escape "$ALERT_EMAIL_FROM")" "$EMAIL_TO" "$(json_escape "$subject")" "$(json_escape "$body")")" \
      && { log "alerta enviado (email): $subject"; sent=1; } \
      || log "FALHA alerta email: $subject"
  fi
  [ "$sent" = "0" ] && log "nenhum canal ativo/configurado — alerta suprimido: $subject"
  return 0
}

load_channels

# ---- Coleta de falhas -------------------------------------------------------
FAILS=""
DETAILS=""
add_fail() { FAILS+="$1"$'\n'; DETAILS+="$1: $2"$'\n'; }

# 1) Site responde 200
code=$(curl -sS -m "$CURL_TIMEOUT" -o /dev/null -w '%{http_code}' \
  -H 'Accept: text/html' "$SITE_URL/" 2>/dev/null || echo "000")
[ "$code" = "200" ] || add_fail "site" "GET $SITE_URL/ -> HTTP $code (esperado 200)"

# 2) Convex executa função (pega o cenário 'deployment desabilitado')
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

# --test envia um alerta de teste e sai
if [ "${1:-}" = "--test" ]; then
  send_alert "🔧 [$HOSTLABEL] Teste do monitor Suricatoos" \
    "Se você recebeu isto, o canal de alerta está funcionando. $(ts)"
  echo "teste disparado (ver $LOG_FILE)"
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

printf '%s\n' "$CUR_FAILS" | sed '/^$/d' > "$STATE_FILE"
exit 0
