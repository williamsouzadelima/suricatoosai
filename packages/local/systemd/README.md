# Run the connector as a systemd service (supervised)

Running `@suricatoos/local` under **systemd** makes the Remote Control **"Update"**
button actually self-apply. The agent detects it's supervised (systemd sets
`INVOCATION_ID`): on update it installs the new version and exits `1`, and systemd
relaunches it into the new version. Run unsupervised (a bare `suricatoos-local`
or `npx` in a terminal) the agent can only install the new version on disk and
then asks you to restart it by hand — which is why an updated-but-unrestarted
connector keeps showing the old version in the panel.

It also keeps the connector alive across reboots and network drops.

> The connector is a full-access ("dangerous") agent by design, so on a Kali /
> pentest box it runs as **root**. Only install this on machines you own.

## Install

On the connector box, as root:

```bash
# from the repo:
sudo SURICATOOS_TOKEN=hsb_your_token bash packages/local/systemd/install.sh

# or without the repo (copy install.sh over, or):
curl -fsSL https://raw.githubusercontent.com/<org>/<repo>/main/packages/local/systemd/install.sh \
  | sudo SURICATOOS_TOKEN=hsb_your_token bash
```

The script: installs `@suricatoos/local@latest` globally, writes your token to a
root-only `/etc/suricatoos/connector.env` (chmod 600, never echoed, never in the
unit file), and writes `/etc/systemd/system/suricatoos-connector.service` with the
detected `node`/bin paths.

If you omit `SURICATOOS_TOKEN` and run it in a terminal, it prompts for the token
(input hidden). You can also create `connector.env` yourself first and run it with
no token to keep the existing one.

Then:

```bash
# stop any MANUAL connector first (Ctrl+C in its terminal) so you don't run two
sudo systemctl enable --now suricatoos-connector
journalctl -u suricatoos-connector -f
```

The box should appear in **Settings → Remote control** on the new version, and the
"Update" button for it will now self-apply on future releases.

## Update the token later

```bash
printf 'SURICATOOS_TOKEN=hsb_new_token\n' | sudo tee /etc/suricatoos/connector.env >/dev/null
sudo chmod 600 /etc/suricatoos/connector.env
sudo systemctl restart suricatoos-connector
```

## Uninstall

```bash
sudo systemctl disable --now suricatoos-connector
sudo rm /etc/systemd/system/suricatoos-connector.service
sudo systemctl daemon-reload
# optional: sudo rm -rf /etc/suricatoos
```

## Notes

- **Restart policy is `on-failure` on purpose.** Self-update exits `1` (relaunch);
  **revocation exits `0` (stays stopped)**. `Restart=always` would relaunch a
  revoked agent into a `connect()` the server rejects.
- The token is **not** on the command line. systemd loads it from the root-only
  `EnvironmentFile` into `SURICATOOS_TOKEN` and the agent reads it from the
  environment, so it never appears in `ps` / `/proc/<pid>/cmdline`. (`suricatoos-
  reference.service` is a static copy of the generated unit for reference —
  `install.sh` is the supported path, since it fills in the real `node`/bin paths
  for your box.)
