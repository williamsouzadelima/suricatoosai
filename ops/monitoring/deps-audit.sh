#!/usr/bin/env bash
# Auditoria semanal de dependências de PRODUÇÃO. Se houver vulnerabilidade
# critical/high, posta no endpoint interno de segurança (localhost:3000), que
# grava anomaly.detected e dispara o e-mail/Teams de monitorSettings.
#
# Segredo em /etc/suricatoos-monitor.env (chmod 600): CONVEX_SERVICE_KEY.
# Agendado por systemd (deps-audit.timer, semanal). Fail-open: qualquer erro
# apenas sai sem alertar (NUNCA quebra nada).
set -uo pipefail

ENV_FILE="${MONITOR_ENV_FILE:-/etc/suricatoos-monitor.env}"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi
KEY=$(printf '%s' "${CONVEX_SERVICE_KEY:-}" | tr -d "\"' \t\r\n")
[ -z "$KEY" ] && { echo "sem CONVEX_SERVICE_KEY — nada a fazer"; exit 0; }

REPO="${REPO_DIR:-/root/suricatoos}"
cd "$REPO" || { echo "repo não encontrado: $REPO"; exit 0; }
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1090
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && nvm use 22.23.2 >/dev/null 2>&1

# Baseline de "high" aceitas (ex.: ReDoS do brace-expansion patchado p/ compat,
# que o time já aceita). Alerta em QUALQUER crítica, ou high ACIMA do baseline
# (vuln nova) — evita e-mail semanal repetido das vulns conhecidas.
BASELINE_HIGH="${DEPS_BASELINE_HIGH:-2}"

AUDIT=$(pnpm audit --prod --json 2>/dev/null)
SUMMARY=$(printf '%s' "$AUDIT" | node -e '
let raw="";try{raw=require("fs").readFileSync(0,"utf8").trim();}catch(e){}
let adv={};
try{adv=JSON.parse(raw).advisories||{};}catch(e){
  for(const l of raw.split(/\n/)){try{const o=JSON.parse(l);if(o.advisory)adv[o.advisory.id]=o.advisory;}catch(_){}}
}
let crit=0,high=0;const pk=new Set();
for(const a of Object.values(adv)){
  if(a.severity==="critical"){crit++;pk.add(a.module_name||a.name);}
  else if(a.severity==="high"){high++;pk.add(a.module_name||a.name);}
}
process.stdout.write(crit+"|"+high+"|"+[...pk].slice(0,8).join(", "));
' 2>/dev/null)

[ -z "$SUMMARY" ] && { echo "audit vazio/erro — nada a fazer"; exit 0; }

CRIT="${SUMMARY%%|*}"; REST="${SUMMARY#*|}"; HIGH="${REST%%|*}"; PKGS="${REST#*|}"
# Só alerta em crítica, ou high acima do baseline (vuln nova).
if [ "${CRIT:-0}" -eq 0 ] && [ "${HIGH:-0}" -le "$BASELINE_HIGH" ]; then
  echo "sem vuln nova (crit=$CRIT high=$HIGH baseline=$BASELINE_HIGH)"
  exit 0
fi
DETAIL="[deps] $CRIT critica(s) + $HIGH high em dependencias de producao: $PKGS"
BODY=$(node -e 'process.stdout.write(JSON.stringify({detail:process.argv[1]}))' "$DETAIL")

CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 \
  -X POST "http://localhost:3000/api/internal/security-alert" \
  -H "Content-Type: application/json" -H "x-service-key: $KEY" \
  --data "$BODY")
echo "alerta postado (HTTP $CODE): $DETAIL"
