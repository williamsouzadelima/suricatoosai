# @suricatoos/local

Suricatoos Local Sandbox Client - Execute commands on your local machine from Suricatoos.

## Quick Start

No installation or manual token handling is required:

1. Go to [Suricatoos Settings](https://hackerai.co/settings)
2. Open "Remote Control"
3. Click "Copy connect command"
4. Paste and run the command in your terminal

The copied command runs the latest package with your authentication token
included automatically.

## Global Installation (Optional)

```bash
npm install -g @suricatoos/local
```

After installation, copy the connect command from Suricatoos Settings and replace
`npx @suricatoos/local@latest` with `suricatoos-local`. Leave the generated
arguments unchanged.

Commands run directly on your host OS. The client connects to Suricatoos and relays commands in real-time.

## Options

| Option               | Description                                                           |
| -------------------- | --------------------------------------------------------------------- |
| `--token TOKEN`      | Authentication token included in the copied command (required)        |
| `--name NAME`        | Optional connection name fallback (default: hostname)                 |
| `--idle-timeout MIN` | Auto-terminate after MIN minutes with no commands (default: disabled) |
| `--convex-url URL`   | Override backend URL included for non-production environments         |
| `--help, -h`         | Show help message                                                     |

## Security

Commands run directly on your OS without any isolation. Only connect machines you trust and control.

The connector stays active until you revoke it in Remote Control settings. On revocation it detects it automatically (within ~20s), shuts down, and removes itself from this machine so nothing keeps consuming resources. Pass `--idle-timeout <minutes>` to also auto-terminate after a period of inactivity (disabled by default).

## License

MIT
