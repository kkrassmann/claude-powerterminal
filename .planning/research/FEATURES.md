# Feature Research

**Domain:** Web-based Terminal Management Dashboard
**Researched:** 2026-02-24
**Confidence:** HIGH

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist. Missing these = product feels incomplete.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Multiple terminal display (grid/tabs) | Core value - manage many terminals at once. Terminator, Tilix, Windows Terminal all have this. | MEDIUM | Grid layout preferred for overview. 6-10 terminals simultaneously. |
| Terminal I/O (input/output) | Basic terminal functionality. All terminal emulators have this via xterm.js + node-pty. | LOW | xterm.js + node-pty + WebSocket is proven pattern. |
| Create new terminal session | Can't manage terminals if you can't create them. Portainer has "Add Container", terminals need "New Terminal". | LOW | Select working directory, spawn Claude CLI with `--session-id`. |
| Close/kill terminal session | Cleanup after work is done. All terminal managers support this. | LOW | Kill PTY process, remove from grid. |
| Session persistence (save/restore) | Critical for multi-instance workflows. tmux/screen's killer feature. Claude CLI has `--resume`. | MEDIUM | Save session IDs to disk, restore with `claude --resume <id>` on app restart. |
| Split panes within window | Standard since tmux. VS Code, Windows Terminal, Tilix all support. Users expect it. | MEDIUM | Horizontal/vertical splits. May defer to v1.1 if grid layout sufficient. |
| Scrollback history | Can't use a terminal without reviewing past output. xterm.js has built-in support. | LOW | xterm.js handles this. Store buffer for reconnect replay. |
| Basic terminal controls (resize, focus) | Standard interaction patterns from every terminal manager. | LOW | xterm.js provides API. Grid tiles need resize/focus handlers. |

### Differentiators (Competitive Advantage)

Features that set the product apart. Not required, but valuable.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Status detection (working/waiting/done)** | Core differentiator - solves "which terminal needs attention?" problem. Not in any comparable product. | HIGH | Combine PTY output parsing (Claude's prompt patterns) + idle timeout heuristic. Most complex feature. |
| **Audio notifications on state change** | Proactive attention management. Pull user back when action needed. Warp has notifications, but not audio. | LOW | Play sound when terminal transitions to "waiting for input" or "done". Browser Audio API or terminal bell. |
| **Visual status indicators in grid** | At-a-glance status visibility. Dashboard pattern from Portainer, CloudWatch. Color-coded tiles (green/yellow/red). | LOW | Color-code terminal header/border based on status. Matches dashboard best practices. |
| **Session restoration on app restart** | Persist entire working state across restarts. Claude CLI `--resume` makes this uniquely feasible for Claude workflows. | MEDIUM | Save session IDs + working directories + PTY state. Replay scrollback buffer on reconnect. |
| **Mobile/tablet access** | Monitor terminals from phone/tablet. Remote dashboard access pattern. Uncommon for terminal managers. | LOW | Responsive UI + bind to 0.0.0.0. Portainer and Grafana do this well. |
| **Terminal header metadata (cwd, git branch)** | Context awareness without switching focus. VS Code shows this in terminal tabs. | MEDIUM | Parse PTY output for prompt info or poll git/directory separately. May defer to v1.1. |
| **Activity highlights/flash on new output** | Visual indicator when background terminals update. Helps track activity across multiple terminals. | LOW | Flash terminal tile border when new output detected while not focused. |

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem good but create problems.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Real-time diff/code review UI | Sounds valuable for monitoring Claude changes | Massive scope creep. Requires file watching, diff parsing, syntax highlighting. Not core to "which terminal needs attention?" | Defer to Phase 2. User can switch to IDE for code review. Status visibility is enough for v1. |
| Terminal multiplexing (tmux/screen integration) | Users familiar with tmux may want integration | Adds complexity, conflicts with web-based PTY model. Windows support is painful. | Direct PTY spawning is simpler and Windows-compatible. Session persistence achieves same goal. |
| User authentication / multi-user | Seems necessary for web app | Adds OAuth, session management, permissions. Not needed for local network in single-user home office. | Defer until remote access (ngrok) is added. Local network doesn't need auth. |
| Full terminal customization (themes, fonts, keybindings) | Power users want personalization | Feature bloat. Diverts from core value. xterm.js themes are complex. | Ship with single sensible theme. Add themes only if users complain. |
| Log aggregation / search across all terminals | Sounds useful for finding commands/output | Requires indexing, search UI, storage. Scope explosion. Claude already provides conversation history. | Users can use terminal scrollback or Claude's session history. Not needed for v1. |
| AI-based optimization suggestions | "AI for AI" - analyze Claude usage patterns | Gimmicky. Unclear value. Requires ML pipeline, telemetry. | Focus on visibility, not analysis. Let user make decisions with full information. |
| Terminal sharing / collaboration | Remote pair programming appeal | Requires presence system, permissions, conflict resolution. Not for single-user workflow. | Out of scope. User's workflow is solo management of their own Claude instances. |

## Feature Dependencies

```
Session Persistence
    └──requires──> Terminal I/O (can't restore without PTY)
                       └──requires──> Multiple Terminal Display (need somewhere to restore to)

Status Detection
    └──requires──> Terminal I/O (parse PTY output)
    └──enhances──> Audio Notifications (trigger on status change)
    └──enhances──> Visual Status Indicators (display detected state)

Audio Notifications
    └──requires──> Status Detection (what triggers the notification?)

Visual Status Indicators
    └──requires──> Status Detection (what status to display?)

Terminal Header Metadata (cwd, git)
    └──requires──> Terminal I/O (parse prompt or query separately)
    └──conflicts──> Split Panes (where to show header in split view?)

Mobile Access
    └──requires──> Responsive UI (mobile viewport support)
    └──requires──> Local network binding (0.0.0.0, not localhost)

Activity Highlights
    └──requires──> Terminal I/O (detect new output)
    └──conflicts with──> Always-visible terminals (only useful for background tabs)
```

### Dependency Notes

- **Session Persistence requires Terminal I/O:** Can't save/restore sessions without functioning PTY processes to attach to.
- **Status Detection is the keystone:** Most differentiating features (audio, visual indicators) depend on accurate status detection.
- **Terminal Header Metadata conflicts with Split Panes:** If a terminal tile is split into sub-panes, where does the header metadata go? This tension suggests deferring one of them to v1.1.
- **Mobile Access requires responsive UI and network config:** Two separate technical requirements that must both be satisfied.
- **Activity Highlights only useful with grid view:** If all terminals are always visible in the grid, flashing on new output creates noise. Only valuable if implementing tabs or focus modes.

## MVP Definition

### Launch With (v1.0)

Minimum viable product - what's needed to validate core value: "Never lose track of which terminal needs attention."

- [x] **Multiple terminal display (grid layout)** - Core value requires seeing all terminals at once
- [x] **Terminal I/O (xterm.js + node-pty + WebSocket)** - Can't have terminals without terminal emulation
- [x] **Create new terminal session** - User needs to spawn Claude instances from the UI
- [x] **Close/kill terminal session** - Cleanup after terminal work is done
- [x] **Status detection (parsing + idle heuristic)** - The hard problem. Differentiating feature. Essential for core value.
- [x] **Audio notifications on status change** - Proactive attention management. Low effort, high impact.
- [x] **Visual status indicators in grid** - At-a-glance status. Color-coded tiles. Dashboard pattern.
- [x] **Session persistence (save/restore)** - Table stakes for multi-instance workflows. Claude `--resume` makes this feasible.
- [x] **Mobile/tablet access (responsive + 0.0.0.0 bind)** - User wants to check terminals from phone. Low effort to enable.
- [x] **Scrollback buffer replay on reconnect** - Prevents context loss when browser/WebSocket reconnects. Pattern from overseer project.

**MVP Rationale:** These features deliver the core value proposition (status visibility + notifications) while remaining buildable in a single focused phase. Session persistence is table stakes for the use case. Mobile access is cheap to enable and high-value for monitoring scenarios.

### Add After Validation (v1.1)

Features to add once core is working and users provide feedback.

- [ ] **Split panes within terminal tiles** - May not be needed if grid layout is sufficient. Wait for user request.
- [ ] **Terminal header metadata (cwd, git branch)** - Nice-to-have context. Adds complexity (parsing or polling). Evaluate if users miss it.
- [ ] **Activity highlights on new output** - Only useful if adding focus modes or tabs. Depends on user behavior patterns.
- [ ] **Terminal themes/appearance customization** - Wait for user complaints about default theme. May not be needed.
- [ ] **Keyboard shortcuts / hotkeys** - Power user feature. Add if users request faster navigation.

### Future Consideration (v2.0+)

Features to defer until product-market fit is established.

- [ ] **Code review / inline diff view** - Phase 2 feature. Large scope. Deferred per PROJECT.md.
- [ ] **Log analysis / AI optimization suggestions** - Phase 2 feature. Requires ML/telemetry. Unclear value.
- [ ] **Remote access via ngrok / internet tunneling** - Deferred per PROJECT.md. Local network only for v1.
- [ ] **User authentication / multi-user support** - Only needed when adding remote access. Single user for now.
- [ ] **Terminal search / log aggregation** - Scope explosion. Users have Claude session history and terminal scrollback.
- [ ] **Terminal sharing / collaboration** - Out of scope for single-user workflow. Not requested.

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Status detection (parsing + idle) | HIGH | HIGH | P1 (MVP) |
| Session persistence (save/restore) | HIGH | MEDIUM | P1 (MVP) |
| Multiple terminal display (grid) | HIGH | MEDIUM | P1 (MVP) |
| Visual status indicators | HIGH | LOW | P1 (MVP) |
| Audio notifications | HIGH | LOW | P1 (MVP) |
| Terminal I/O (xterm.js + node-pty) | HIGH | LOW | P1 (MVP) |
| Create/close terminal sessions | HIGH | LOW | P1 (MVP) |
| Scrollback buffer replay | MEDIUM | MEDIUM | P1 (MVP) |
| Mobile/tablet access | MEDIUM | LOW | P1 (MVP) |
| Terminal header metadata (cwd, git) | MEDIUM | MEDIUM | P2 (v1.1) |
| Split panes | MEDIUM | MEDIUM | P2 (v1.1) |
| Activity highlights | LOW | LOW | P2 (v1.1) |
| Terminal themes/customization | LOW | MEDIUM | P2 (v1.1) |
| Code review / diff view | MEDIUM | HIGH | P3 (v2.0+) |
| Log analysis / AI suggestions | LOW | HIGH | P3 (v2.0+) |
| Remote access (ngrok) | MEDIUM | MEDIUM | P3 (v2.0+) |
| User authentication | LOW | HIGH | P3 (v2.0+) |

**Priority key:**
- P1: Must have for launch (MVP)
- P2: Should have, add after validation (v1.1)
- P3: Nice to have, future consideration (v2.0+)

## Competitor Feature Analysis

| Feature | tmux/screen | Warp | VS Code Terminal | Windows Terminal | Portainer (UI pattern) | Our Approach |
|---------|-------------|------|------------------|------------------|------------------------|--------------|
| Multiple terminals | Session/window/pane model | Tabs + splits | Tabs + split panes | Tabs + panes | Container grid dashboard | **Grid layout** (overview at a glance) |
| Session persistence | ✅ Core feature (detach/attach) | ❌ Local only | ❌ Loses state on restart | ❌ Loses state | ❌ N/A | ✅ Claude `--resume` integration |
| Status detection | ❌ Manual (user checks) | ⚠️ AI context, not terminal state | ⚠️ Running indicator only | ❌ None | ✅ Container status (running/stopped) | ✅ **Parsing + idle heuristic (differentiated)** |
| Audio notifications | ❌ None | ⚠️ Notifications, not audio | ❌ None | ❌ None | ⚠️ Alerts, not terminal-focused | ✅ **Audio on state change** |
| Visual indicators | ❌ Text-only UI | ✅ Blocks, modern UI | ⚠️ Small status dot | ⚠️ Tab colors (manual) | ✅ Color-coded containers | ✅ **Color-coded grid tiles** |
| Split panes | ✅ Core feature | ✅ Supported | ✅ Core feature | ✅ Core feature | ❌ N/A | ⚠️ **Defer to v1.1** (grid may be enough) |
| Web-based | ❌ SSH required | ❌ Native app | ❌ Native app | ❌ Native app | ✅ Web dashboard | ✅ **Web dashboard (browser + mobile)** |
| Mobile access | ⚠️ Via SSH app | ❌ Native app only | ❌ Native app only | ❌ Native app only | ✅ Responsive UI | ✅ **Responsive + 0.0.0.0 bind** |
| Git integration | ❌ None | ✅ Git awareness | ✅ Git branch in tab | ❌ None | ❌ N/A | ⚠️ **Defer to v1.1** |
| Themes/customization | ⚠️ Via config | ✅ Extensive | ✅ Extensive | ✅ Extensive | ⚠️ Limited | ⚠️ **Defer to v1.1** (anti-feature) |

**Key Insights:**
- **Status detection is genuinely differentiated:** None of the comparable products solve "which terminal needs attention?" at the level needed for parallel AI workflows.
- **Session persistence is rare in terminals:** tmux/screen have it for remote sessions, but local terminal emulators (Warp, VS Code, Windows Terminal) don't persist state across restarts. Claude `--resume` makes this uniquely feasible.
- **Portainer's dashboard model is the right UI pattern:** Container grid with color-coded status is exactly what this product needs. Terminals are like containers - long-running processes with state that need monitoring.
- **Split panes may not be necessary:** If grid layout provides overview, and users can focus/maximize individual terminals, split panes might be feature bloat. Wait for user feedback.
- **Web-based + mobile is uncommon for terminal managers:** Most are native apps. This is a differentiator, enabled by the web dashboard model.

## Sources

### Terminal Multiplexers & Emulators
- [tmux: The Complete Guide for 2026](https://devtoolbox.dedyn.io/blog/tmux-complete-guide)
- [Terminal Multiplexers: tmux vs Zellij Comparison](https://dasroot.net/posts/2026/02/terminal-multiplexers-tmux-vs-zellij-comparison/)
- [Best Terminal Emulators for Developers in 2026](https://scopir.com/posts/best-terminal-emulators-developers-2026/)
- [Slant - Best terminal multiplexers as of 2026](https://www.slant.co/topics/4018/~terminal-multiplexers)

### Modern Terminals
- [Warp: The Agentic Development Environment](https://www.warp.dev/)
- [Is Warp Terminal Worth It in 2026?](https://www.isitworth.site/reviews/warp-terminal)
- [Windows Terminal Panes - Microsoft Learn](https://learn.microsoft.com/en-us/windows/terminal/panes)
- [VS Code Terminal Basics](https://code.visualstudio.com/docs/terminal/basics)

### Web-Based Terminal Technologies
- [ttyd - Share your terminal over the web](https://github.com/tsl0922/ttyd)
- [Best Open Source Web Terminals for Embedding in Your Browser](https://sabujkundu.com/best-open-source-web-terminals-for-embedding-in-your-browser/)
- [xterm.js Official Site](https://xtermjs.org/)
- [Web Terminal with Xterm.JS, node-pty and web sockets](https://ashishpoudel.substack.com/p/web-terminal-with-xtermjs-node-pty)
- [Creating A Browser-based Interactive Terminal](https://www.eddymens.com/blog/creating-a-browser-based-interactive-terminal-using-xtermjs-and-nodejs)

### Session Management & Status
- [Claude Code Session Management](https://stevekinney.com/courses/ai-development/claude-code-session-management)
- [Resume Claude Code Sessions After Restart](https://mehmetbaykar.com/posts/resume-claude-code-sessions-after-restart/)
- [GitHub - claude-session-manager](https://github.com/drewburchfield/claude-session-manager)
- [TIL: Get a sound notification in Claude Code when a task is complete](https://velvetshark.com/til/claude-code-sound-notification)

### Dashboard UI & Monitoring
- [Portainer Dashboard Documentation](https://docs.portainer.io/user/docker/dashboard)
- [Portainer Features](https://www.portainer.io/features)
- [Dashboard Design UX Patterns Best Practices](https://www.pencilandpaper.io/articles/ux-pattern-analysis-data-dashboards)
- [Effective Dashboard Design Principles for 2025](https://www.uxpin.com/studio/blog/dashboard-design-principles/)
- [Best Practices For Animated Progress Indicators](https://www.smashingmagazine.com/2016/12/best-practices-for-animated-progress-indicators/)

### Terminal Grid & Tiling
- [Tilix: A tiling terminal emulator](https://gnunn1.github.io/tilix-web/)
- [Terminator: The Tiling Terminal Emulator for Linux Pros](https://itsfoss.com/terminator/)
- [WTF - the terminal dashboard - Grid Layout](https://wtfutil.com/configuration/grid_layout/)
- [Pane Grid and Multi-Terminal Management - COSMIC Terminal](https://deepwiki.com/pop-os/cosmic-term/2.4-pane-grid-and-multi-terminal-management)

### WebSocket & Reconnection
- [How to Implement Reconnection Logic for WebSockets](https://oneuptime.com/blog/post/2026-01-27-websocket-reconnection-logic/view)
- [WebSocket Reconnect: Strategies for Reliable Communication](https://apidog.com/blog/websocket-reconnect/)

### Remote Access & Mobile
- [How to provide secure remote access to Grafana dashboards](https://tailscale.com/learn/remote-access-to-grafana-dashboards)
- [Best Remote Control Software of 2026](https://www.splashtop.com/blog/remote-control)
- [Pitikapp Remote Dashboard](https://pitikapp.com/)

---
*Feature research for: Web-based Terminal Management Dashboard*
*Researched: 2026-02-24*
