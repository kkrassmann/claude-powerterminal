# Claude PowerTerminal

**Run 6-10+ Claude Code sessions at once. See which ones need you. Ignore the rest.**

<img width="1252" height="848" alt="Claude PowerTerminal dashboard showing multiple sessions in a tiled grid" src="https://github.com/user-attachments/assets/c211fc62-dc92-4abb-87a3-dc5e4307e46b" />

A desktop dashboard for power users who run many [Claude CLI](https://docs.anthropic.com/en/docs/claude-code) sessions in parallel. Each session lives in a tile with live terminal output, real-time status detection, and audio alerts — so you only context-switch when it matters.

## Usage

```bash
npx claude-powerterminal
```

Downloads the correct binary for your platform, caches it locally, and launches the app.

```bash
npx claude-powerterminal --clear-cache   # Re-download on next run
npx claude-powerterminal --version       # Show version
```

## What You Get

- **Multi-session grid** — spawn sessions in a tiled layout, drag to reorder, double-click to maximize
- **Intelligent status detection** — each session classified as WORKING / THINKING / WAITING / ERROR / DONE
- **Audio & visual alerts** — notification sounds when a session needs input or errors out
- **Session analysis** — practice score out of 100, anti-pattern detection, actionable recommendations
- **Session persistence** — sessions survive app restarts via `--resume`
- **LAN access** — monitor from any device on your network at `http://<your-ip>:9801`
- **Git context** — branch and file change counts in each tile header

## Requirements

- Node.js 18+
- [Claude CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated

## Supported Platforms

| Platform | Arch | Format |
|----------|------|--------|
| Windows | x64 | Portable `.exe` |
| Linux | x64 | `.AppImage` |

## Links

- [GitHub](https://github.com/kkrassmann/claude-powerterminal)
- [Releases](https://github.com/kkrassmann/claude-powerterminal/releases)
- [License (GPL-3.0)](https://github.com/kkrassmann/claude-powerterminal/blob/main/LICENSE)
