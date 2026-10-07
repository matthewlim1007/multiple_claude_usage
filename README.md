# Claude Usage

Shows your Claude **5-hour** and **weekly** usage limits — for multiple accounts — in the VS Code status bar and a sidebar panel.


## How it works

Usage comes from the same endpoint Claude Code's `/usage` command uses (`GET https://api.anthropic.com/api/oauth/usage`),
authenticated with each account's Claude Code OAuth login. Nothing is sent anywhere else.

Each **account** is a Claude Code config directory (what you pass as `CLAUDE_CONFIG_DIR`):

| Profile            | How you run it                                  |
| ------------------ | ----------------------------------------------- |
| `~/.claude`        | `claude`                                        |
| `~/.claude-work`   | `CLAUDE_CONFIG_DIR=~/.claude-work claude`       |

`~/.claude` and `~/.claude-*` are discovered automatically. Credentials are read (never written) from:

- **macOS:** Keychain item `Claude Code-credentials` (default profile) or `Claude Code-credentials-<sha256(dir)[0:8]>`
- **Linux/Windows:** `<configDir>/.credentials.json`

You can also add an account by pasting an OAuth access token (stored in VS Code SecretStorage).

## Usage

- **Status bar:** `name 5h% · weekly%` per account; turns yellow/red past the warning/danger thresholds. Hover for details, click for the panel.
- **Sidebar (gauge icon):** progress bars for 5-hour, weekly and per-model weekly limits, with reset countdowns.
- **Commands:** `Claude Usage: Refresh`, `Add Account`, `Remove Account`, `Show Usage Panel`.

### Expired logins

OAuth access tokens expire after a few hours and Claude Code refreshes them when you use it. If a profile hasn't been
used recently the panel shows *Login expired* with an **Open Claude in terminal** button — start Claude Code for that
profile once and hit Refresh. The extension deliberately doesn't refresh tokens itself, since that would rotate the
refresh token out from under Claude Code.

## Settings

| Setting                              | Default | Description                                         |
| ------------------------------------ | ------- | --------------------------------------------------- |
| `claudeUsage.accounts`               | `[]`    | Extra profiles: `{ "name", "configDir", "keychainService"? }` |
| `claudeUsage.autoDiscover`           | `true`  | Track `~/.claude` and `~/.claude-*` automatically   |
| `claudeUsage.excludeDirs`            | `[]`    | Discovered profiles to ignore                        |
| `claudeUsage.refreshIntervalSeconds` | `300`   | Poll interval (min 60)                               |
| `claudeUsage.statusBar`              | `all`   | `all`, `highest`, or `off`                           |
| `claudeUsage.warningThreshold`       | `75`    | % highlighted yellow                                 |
| `claudeUsage.dangerThreshold`        | `90`    | % highlighted red                                    |

## Develop

```sh
npm install
npm run compile      # or: npm run watch
# F5 in VS Code → "Run Extension"
npm run package      # → claude-usage-0.1.0.vsix
```
