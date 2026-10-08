# Runbook de Resposta a Incidentes — ai.suricatoos.com

Procedimento operacional para detectar, conter, erradicar e recuperar de
incidentes de segurança no ambiente de produção. Secret-free por design —
referencia painéis, funções e variáveis de ambiente **por nome**, nunca valores.

> **Ciclo:** Detectar → Triar → **Conter** → Erradicar → Recuperar → Pós-incidente.
> Mantenha a calma, registre tudo, e prefira a ação **reversível** mais contida.

---

## 0. Antes de tudo — entenda as alavancas (e uma pegadinha)

| Alavanca | Onde | O que faz |
|---|---|---|
| **Modo de defesa** | `/admin` → aba **Segurança** (`SecurityDefenseSection`) | `shadow` (detecta+alerta, **não bloqueia**) vs `enforce` (bloqueia) |
| **Auto-block IP / Auto-suspend** | mesma aba | liga o bloqueio automático de IP e a suspensão de usuário (só valem em `enforce`) |
| **Blocklist** | mesma aba (`/api/admin/security/blocklist`) | bloqueio manual de IP (aplicado na borda; CIDR/UA/path são **registrados mas NÃO aplicados** hoje) |
| **Safelist** | mesma aba | IPs/user-ids que NUNCA são bloqueados/suspensos |
| **Trilha de auditoria** | `/admin` → Segurança → **Auditoria de segurança** (`SecurityAuditTab`) | log **imutável** de tudo (threat/enumeration/anomaly/ip.blocked/report.*/evidence.*/membership.*). Exporta CSV |
| **Alertas** | `/admin` → **Alertas** | destino de e-mail (Resend) / Teams. Eventos de segurança já disparam e-mail |
| **Suspender usuário** | `/admin` → **Usuários** (`adminSuspend`/`adminUnsuspend`) | bloqueia chat/custo do usuário (NÃO mata sessão nem revoga token) |
| **Teto de gasto** | billing do engajamento (`enforceBudget`) | corta runs por custo; kill-switch global `BUDGET_ENFORCEMENT_DISABLED` |
| **Portal do cliente** | card "Acesso ao portal" do engajamento | desligar o portal de um cliente (kill-switch por tenant) + revogar membership |
| **Runs ao vivo** | `/admin` → Visão geral (`LiveRunsPanel`) | abortar um run de agente em andamento |
| **fail2ban** | host (`/etc/fail2ban/jail.local`) | bane IP no firewall nftables (SSH; HTTP = follow-up) |
| **WorkOS** | `/api/logout-all` / painel WorkOS | encerrar sessões; política de MFA |
| **Convex** | dashboard `dutiful-sheep-343` | dados, logs de função, rotação do service key |

> ⚠️ **PEGADINHA DO `kill_switch`:** o `kill_switch` da aba Segurança **DESLIGA TODA a defesa**
> (detecção + bloqueio). Ele é um "desligar o enforcement" de emergência (ex.: a defesa
> está bloqueando usuário legítimo por falso-positivo durante um surto). **NÃO é ferramenta
> de contenção de ataque** — para conter um ataque você faz o OPOSTO: garanta `kill_switch=off`
> e vá para `enforce`. (Em 09/10/2026 ele foi achado ligado, deixando a defesa inerte.)

---

## 1. Severidade

- **SEV1 (crítico):** comprometimento ativo — exfiltração de dados de cliente (relatórios/evidência),
  comprometimento de credencial/sessão de admin, RCE/foothold no host, ou vazamento cross-tenant.
- **SEV2 (alto):** ataque em andamento sem comprometimento confirmado — exploit sendo tentado,
  enumeração agressiva, abuso de API por usuário autenticado, DoS/custo descontrolado.
- **SEV3 (baixo):** scanning/ruído de fundo, tentativa isolada bloqueada, CVE de dependência sem
  exploração observada.

---

## 2. Detectar

Fontes (em ordem de sinal):
1. **E-mail de alerta** (→ caixa do CISO): `threat.detected`, `enumeration.detected`,
   `anomaly.detected`, `user.autoblocked`. Dispara via `dispatchSecurityNotify` (Resend).
2. **Auditoria de segurança** (`/admin` → Segurança): filtre por tipo de evento, veja ator/IP/alvo.
3. **fail2ban** no host: `fail2ban-client status sshd` (IPs banidos).
4. **Monitor de saúde** (`ops/monitoring/`): quedas de serviço, disco, RAM.
5. **Convex dashboard**: erros de função, picos de uso.
6. **Relato humano** / comportamento anômalo da aplicação.

---

## 3. Triar (≤ 5 min)

- **O que** (classe: exploit, enumeração, abuso autenticado, exfiltração, DoS/custo, infra).
- **Quem** (IP + se é usuário autenticado — pegue o `user_id`/e-mail na Auditoria).
- **Escopo** (um tenant? cross-tenant? dado sensível tocado? só tentativa ou sucesso?).
- **SEV** (acima). Anote o horário de início (o audit log é a fonte da verdade imutável).

---

## 4. Conter (a ação mais importante)

Escolha pela classe. Prefira o bloqueio **mais contido** que pare o ataque.

### Atacante não-autenticado (scanning / exploit / enumeração)
1. Garanta `kill_switch=off` e defesa em **`enforce`** (aba Segurança) — liga auto-block/auto-suspend.
2. **Bloqueie o IP** na Blocklist (`/api/admin/security/blocklist`, type `ip`) — aplica na borda em ~30s.
3. O **fail2ban** reforça no firewall do host (nftables). Para um IP persistente, confirme o ban.
4. Se for um CIDR/rede, hoje o CIDR da blocklist **não é aplicado** — use o **fail2ban**/nftables no host.

### Atacante AUTENTICADO abusando da aplicação/API
1. Pegue o `user_id` na Auditoria.
2. **Suspenda o usuário** (`/admin` → Usuários → `adminSuspend`) — bloqueia chat/custo.
   ⚠️ Isso **NÃO mata a sessão nem revoga o token** — o atacante pode continuar batendo em
   endpoints não-privilegiados. Para cortar de verdade:
3. **Encerre as sessões** no WorkOS (`/api/logout-all` para o usuário, ou revogue no painel WorkOS).
4. Se admin/superadmin comprometido: **rotacione** segredos relevantes (service key do Convex,
   chaves de provedor) e force re-login com MFA.
5. Bloqueie o IP de origem também (defesa em profundidade).

### Exfiltração / vazamento de dado (relatório, evidência, portal)
1. **Desligue o portal** do cliente afetado (card "Acesso ao portal" → Desabilitar) e **revogue a
   membership** suspeita — corta o acesso do cliente na hora.
2. Marque relatórios sensíveis como **não-visíveis ao cliente** (toggle "Visível ao cliente").
3. Verifique a Auditoria por `report.downloaded`/`evidence.viewed`/`finding.viewed` do ator —
   o que foi acessado, quando, de qual IP.
4. Se o vetor foi credencial: encerre sessões + rotacione.

### DoS / custo descontrolado (runaway spend)
1. **Abortar os runs ao vivo** (`LiveRunsPanel` na Visão geral).
2. Ligue/ajuste o **teto por engajamento** (enforce) ou o budget per-user/per-task.
3. Em último caso, `BUDGET_ENFORCEMENT_DISABLED` deve estar **off** (ligado = sem enforcement).
4. Bloqueie o IP/usuário de origem.

### Dependência vulnerável sendo explorada (0-day / CVE ativo)
1. Contenção imediata: bloqueie o padrão de exploit (IP/caminho) e/ou suba o modo `enforce`.
2. **Patch:** `pnpm audit --prod` para confirmar, bump da dep / override, `tsc` + build, e **deploy**
   (ver o runbook de deploy: push → host pull → `pnpm install` → build → restart next+trigger).
   Isto é update testado + redeploy — não existe "patch em tempo de vôo".

### Comprometimento de host / infra (SEV1)
1. Isole: o firewall nftables já é default-drop; feche mais se necessário (NÃO se tranque fora do SSH).
2. Preserve evidência (logs, `journalctl`, estado do processo) **antes** de mexer.
3. Rotacione TODO segredo que tocou o host. Considere reprovisionar o host do zero.

---

## 5. Erradicar

- Remova o foothold (processo/arquivo/usuário malicioso, dado injetado).
- **Rotacione** credenciais expostas (service key do Convex, chaves de provedor, tokens).
- Aplique o **patch** definitivo (dependência, config, código) e faça deploy.
- Confirme que a blocklist/safelist/suspensões refletem a decisão final.

## 6. Recuperar

- Volte serviços afetados; confirme saúde (`ops/monitoring/`, HTTP 200, trigger "worker ready").
- **Desfaça falsos-positivos:** `adminUnsuspend`, `liftBlock` (blocklist), remova bans do fail2ban
  (`fail2ban-client unban <ip>`), tire da safelist o que não precisa mais.
- Se subiu para `enforce` só para conter e quer validar antes de manter, volte para `shadow` e
  observe os alertas.

## 7. Pós-incidente

- **Timeline** a partir da Auditoria imutável (exporte o CSV).
- **Causa-raiz** e **ação corretiva** (threshold a ajustar? gap a fechar? dep a atualizar?).
- Atualize este runbook e a safelist/blocklist conforme aprendido.
- Grave a lição na base de conhecimento.

---

## Gaps conhecidos (para calibrar expectativa durante um incidente)
- Detecção de anomalia do app é **in-memory / por-processo** → zera a cada deploy; IP é spoofável
  sem validação de proxy confiável. O **fail2ban** (host) é mais durável.
- Blocklist **CIDR/User-Agent/Path NÃO é aplicada** (só IP). Use o firewall do host para rede.
- Auto-suspend **não mata sessão** — combine com `logout-all`/revoke no WorkOS.
- **Sem IDS de rede** (Suricata não instalado — só o endpoint receptor `/api/internal/security-alert`).
- **Sem WAF** (sem inspeção de payload para SQLi/XSS/traversal) — o `enforce` pega rajada/enumeração,
  não assinatura de exploit por conteúdo.
- fail2ban **HTTP (assinatura de exploit)** é follow-up (o access log do Caddy precisa de setup limpo).
