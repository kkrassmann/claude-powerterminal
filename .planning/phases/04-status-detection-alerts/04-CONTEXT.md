# Phase 4: Status Detection & Alerts - Context

**Gathered:** 2026-02-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Detect terminal status (working/waiting for input/thinking/error/done) via PTY output pattern matching and idle heuristics. Show color-coded visual indicators on each terminal tile. Play audio alerts on key state transitions. Provide a global mute toggle.

</domain>

<decisions>
## Implementation Decisions

### Detection States
- 5 distinct states: WORKING, THINKING, WAITING, ERROR, DONE
- WORKING = actively streaming output (text, tool calls)
- THINKING = no output for 5+ seconds but no prompt detected (Claude processing)
- WAITING = Claude prompt pattern detected (needs user input)
- ERROR = error pattern detected or process crashed/hung
- DONE = PTY process exited (process lifecycle only, not Claude exit messages)

### Pattern Matching Strategy
- Claude CLI-specific patterns, hardcoded (not configurable)
- WAITING patterns: `❯` prompt, `? ... (Y/n)` questions, `Do you want...` permission prompts
- WORKING patterns: `● ` tool call indicator, any new output streaming
- ERROR patterns: `Error:` messages, `Interrupted` (Ctrl+C)
- DONE: PTY process exit event only (shell still alive = still WAITING, not DONE)

### Detection Architecture
- Pattern matching runs in Electron main process, close to PTY output stream
- Status sent to frontend as metadata alongside terminal data via WebSocket
- No duplicate parsing in frontend — main process is the single source of truth

### Visual Status Indicators
- Combined approach: status dot in tile header for all states + box-shadow glow for high-priority states
- Urgency-based color mapping (Catppuccin Mocha palette):
  - WORKING: Green (#a6e3a1) — dot only
  - THINKING: Teal (#94e2d5) — dot only
  - WAITING: Peach (#fab387) — dot + static box-shadow glow
  - ERROR: Red (#f38ba8) — dot + pulsing box-shadow glow (2s cycle)
  - DONE: Lavender (#b4befe) — dot only
- Box-shadow glow style (not solid border): soft aura using multiple box-shadow layers

### Audio Alert Design
- Audio triggers on 3 transitions: → WAITING, → ERROR, → DONE
- No sound on → WORKING transition (user just typed, they know)
- Different sounds per transition type (Web Audio API generated tones):
  - WAITING: Gentle 2-note rising chime
  - ERROR: Low buzzy alert tone
  - DONE: Soft 3-note descending completion sound
- Multi-alert debounce: transitions within 2s window coalesce to single sound
  - Priority: ERROR > WAITING > DONE (highest priority sound wins)

### Idle Timeout Behavior
- 5-second no-output threshold for WORKING → THINKING transition
- THINKING → WAITING transition is pattern-only (no timeout fallback)
  - Prevents false "waiting" alerts during long Claude thinking sessions
- No timeout-based WAITING detection — only real prompt patterns trigger WAITING

### Mute Control
- Global mute toggle only (no per-terminal mute)
- Single button in toolbar: mute/unmute all terminal audio
- Matches STAT-05 requirement

### Claude's Discretion
- Exact Web Audio API frequencies and waveforms for each sound
- Glow intensity and shadow spread values
- Debounce implementation details
- Status dot size and positioning within tile header

</decisions>

<specifics>
## Specific Ideas

- Error glow should pulse slowly (2s cycle) to create visual urgency hierarchy over static waiting glow
- Detection should happen close to PTY (main process) to minimize latency — don't parse in browser
- The "urgency-based" color scheme (green=all good, peach=attention, red=problem) is preferred over traffic-light metaphor

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 04-status-detection-alerts*
*Context gathered: 2026-02-25*
