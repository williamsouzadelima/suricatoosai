#!/usr/bin/env bash
#
# Install the Suricatoos Remote Control connector (@suricatoos/local) as a
# systemd service so it runs supervised. Supervised matters: when you click
# "Update" in the panel, the agent installs the new version and exits(1); under
# systemd it is relaunched into the new version automatically. Run unsupervised
# (a bare `suricatoos-local`/`npx` in a terminal) it can only install-on-disk
# and asks you to restart it by hand.
#
# Run as root on the connector box (a Kali/pentest host). The connector is a
# full-access ("dangerous") agent by design, so it runs as root here.
#
# The token is written ONLY to a root-only env file (chmod 600), never into the
# unit file and never echoed. Provide it one of these ways:
#   sudo SURICATOOS_TOKEN=hsb_xxx bash install.sh      # from env (preferred)
#   sudo bash install.sh                                # prompts if a TTY
#   # or create /etc/suricatoos/connector.env yourself first, then run this.
#
set -euo pipefail

SERVICE="suricatoos-connector"
ENV_DIR="/etc/suricatoos"
ENV_FILE="${ENV_DIR}/connector.env"
UNIT="/etc/systemd/system/${SERVICE}.service"

if [ "$(id -u)" -ne 0 ]; then
  echo "Please run as root (sudo)." >&2
  exit 1
fi

# 1) Install / update the connector globally (public package; no npm auth needed).
#    node-pty is an OPTIONAL dep: it enables interactive PTY shells; the agent runs
#    fine without it (non-interactive commands still work). Newer npm (>=11) blocks
#    a dependency's install scripts behind an allowlist, which stops node-pty's
#    native build — so pass --allow-scripts=node-pty when this npm understands it.
#    Older npm (scripts run by default) never sees the flag and is unaffected.
echo "==> Installing @suricatoos/local@latest globally…"
NPM_MAJOR="$(npm -v 2>/dev/null | cut -d. -f1 || true)"
NPM_ALLOW=()
if [ "${NPM_MAJOR:-0}" -ge 11 ] 2>/dev/null; then
  NPM_ALLOW=(--allow-scripts=node-pty)
fi
npm install -g @suricatoos/local@latest "${NPM_ALLOW[@]}"

BIN="$(command -v suricatoos-local || true)"
if [ -z "${BIN}" ]; then
  echo "suricatoos-local not found on PATH after install." >&2
  echo "Check your npm global prefix (npm config get prefix) and PATH." >&2
  exit 1
fi
NODE_DIR="$(dirname "$(command -v node)")"
echo "    bin : ${BIN}"
echo "    node: ${NODE_DIR}"

# 2) Token → root-only env file. Keep an existing one unless a new token is given.
mkdir -p "${ENV_DIR}"
chmod 700 "${ENV_DIR}"

TOKEN="${SURICATOOS_TOKEN:-}"
if [ -z "${TOKEN}" ] && [ ! -f "${ENV_FILE}" ] && [ -t 0 ]; then
  # Interactive prompt; input is not echoed and never logged.
  printf "Paste the connector token (from Settings > Remote control): " >&2
  read -rs TOKEN
  printf "\n" >&2
fi

if [ -n "${TOKEN}" ]; then
  ( umask 177; printf 'SURICATOOS_TOKEN=%s\n' "${TOKEN}" > "${ENV_FILE}" )
  chmod 600 "${ENV_FILE}"
  echo "==> Wrote token to ${ENV_FILE} (chmod 600)."
  unset TOKEN
elif [ -f "${ENV_FILE}" ]; then
  echo "==> Keeping existing ${ENV_FILE}."
else
  cat >&2 <<MISSING
No token provided and ${ENV_FILE} does not exist.
Create it (root-only), then re-run this script or enable the service:
  printf 'SURICATOOS_TOKEN=YOUR_TOKEN\n' | sudo tee ${ENV_FILE} >/dev/null
  sudo chmod 600 ${ENV_FILE}
MISSING
  exit 1
fi

# 3) Write the unit. Absolute bin path + node dir on PATH (the bin's shebang is
#    `#!/usr/bin/env node`, and systemd's default PATH may not include nvm/node).
#    The token is passed as --token ${SURICATOOS_TOKEN}, expanded by systemd from
#    the root-only env file; on a single-user box its only reader is root, which
#    already holds the token.
cat > "${UNIT}" <<UNIT_EOF
[Unit]
Description=Suricatoos Remote Control connector (@suricatoos/local)
Documentation=https://help.suricatoos.com/
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
Environment=PATH=${NODE_DIR}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
EnvironmentFile=${ENV_FILE}
ExecStart=${BIN} --token \${SURICATOOS_TOKEN}
# on-failure is deliberate and matches the agent's exit-code contract:
#  - self-update exits 1 (failure) -> relaunched into the freshly installed version
#  - revocation exits 0 (success)  -> NOT relaunched (so it won't busy-loop into a
#    connect() the server now rejects)
# The agent reconnects internally through transient network drops, so it rarely
# exits on its own; real crashes (non-zero) are relaunched.
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT_EOF
chmod 644 "${UNIT}"

systemctl daemon-reload
echo "==> Installed unit: ${UNIT}"
echo
echo "Stop any MANUAL connector first (Ctrl+C in its terminal) so you don't run two."
echo "Then enable + start:"
echo "    sudo systemctl enable --now ${SERVICE}"
echo "Follow logs:"
echo "    journalctl -u ${SERVICE} -f"
