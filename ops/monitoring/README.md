# Suricatoos Health Monitor

Monitor self-hosted (roda no próprio host Kali) que verifica a saúde de
ai.suricatoos.com e **alerta na mudança de estado** (cai → alerta; volta →
alerta de recuperação). Nasceu do incidente de 2026-09-07 (Convex free-tier
estourou e desabilitou o deployment → app fora do ar sem ninguém saber).

## O que verifica (a cada ~3 min)

| Check | Falha quando |
|-------|--------------|
| `site` | `GET https://ai.suricatoos.com/` ≠ 200 |
| `convex` | `/api/query` não retorna `status:success` (pega "deployment desabilitado"/"Server Error") |
| `svc:*` | `suricatoos-next`, `suricatoos-trigger`, `suricatoos-connector`, `caddy`, `centrifugo` não `active` |
| `mem` | RAM disponível < `MIN_AVAIL_MB` (150MB) |
| `disk` | `/` acima de `MAX_DISK_PCT` (90%) |

- **Sem spam:** só alerta quando um check MUDA de estado. Guarda o estado em
  `/var/lib/suricatoos-monitor/failing`.
- **Heartbeat diário** opcional (`HEARTBEAT_HOUR`): 1 msg/dia "tudo ok" — se
  ela parar de chegar, o próprio monitor pode ter caído.
- **Log:** `/var/log/suricatoos-monitor.log`.

## Ponto cego (assumido)

Roda NO Kali → **não** detecta o host totalmente fora do ar (rede/energia/kernel).
Para isso caberia um pinger externo (ex.: cron no faraday ou um uptime externo) —
fica como complemento futuro. Para o caso de hoje (app/Convex/serviço com host de
pé) este monitor cobre.

## Instalação no Kali

```bash
# 1) segredo do canal de alerta (NÃO vai pro git)
cp /root/suricatoos/ops/monitoring/suricatoos-monitor.env.example /etc/suricatoos-monitor.env
chmod 600 /etc/suricatoos-monitor.env
$EDITOR /etc/suricatoos-monitor.env     # preencher Telegram OU Resend

# 2) systemd
chmod +x /root/suricatoos/ops/monitoring/healthcheck.sh
cp /root/suricatoos/ops/monitoring/suricatoos-monitor.{service,timer} /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now suricatoos-monitor.timer

# 3) teste do canal + uma rodada real
/root/suricatoos/ops/monitoring/healthcheck.sh --test
systemctl start suricatoos-monitor.service && tail -n5 /var/log/suricatoos-monitor.log
```

## Operação

- Ver quando roda: `systemctl list-timers suricatoos-monitor.timer`
- Rodar na hora: `systemctl start suricatoos-monitor.service`
- Ver log: `tail -f /var/log/suricatoos-monitor.log`
- Estado atual de falhas: `cat /var/lib/suricatoos-monitor/failing`
- Ajustar thresholds/canal: editar `/etc/suricatoos-monitor.env` (efeito imediato)
