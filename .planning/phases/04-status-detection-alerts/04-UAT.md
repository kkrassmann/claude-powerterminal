---
status: testing
phase: 04-status-detection-alerts
source: [04-01-SUMMARY.md, 04-02-SUMMARY.md]
started: 2026-02-25T07:55:00Z
updated: 2026-02-25T07:55:00Z
---

## Current Test

number: 1
name: Status dot visible in tile header
expected: |
  Each terminal tile shows a small colored dot (8px circle) at the left side of the header row, before the working directory path. The dot should be visible on every active terminal tile.
awaiting: user response

## Tests

### 1. Status dot visible in tile header
expected: Each terminal tile shows a small colored dot (8px circle) at the left side of the header row, before the working directory path. The dot should be visible on every active terminal tile.
result: [pending]

### 2. WORKING state (green dot)
expected: When a Claude CLI session is actively generating output (running a tool, writing code), the status dot is green (#a6e3a1). This is the default state when there's recent output.
result: [pending]

### 3. THINKING state (teal dot after 5s idle)
expected: When a Claude session has been idle for 5+ seconds (no output but process still running), the dot transitions from green to teal (#94e2d5). Wait a few seconds after Claude stops outputting and watch the dot change.
result: [pending]

### 4. WAITING state (peach dot + static glow)
expected: When Claude shows its prompt (the ❯ character) waiting for user input, the dot turns peach (#fab387) AND the entire tile gets a soft peach box-shadow glow (static, not pulsing). A 2-note rising chime should also play.
result: [pending]

### 5. ERROR state (red dot + pulsing glow)
expected: When an error occurs in the terminal (e.g., Claude outputs "Error:" text), the dot turns red (#f38ba8) AND the tile gets a pulsing red box-shadow glow that animates on a 2-second cycle. A low buzzy sawtooth tone should play.
result: [pending]

### 6. DONE state (lavender dot)
expected: When the terminal process exits (e.g., type "exit" in the shell or Claude exits), the dot turns lavender (#b4befe). A 3-note descending chime should play.
result: [pending]

### 7. Audio alert on WAITING transition
expected: When a terminal transitions to WAITING (Claude prompt appears), a pleasant 2-note rising chime plays (C5 then E5, sine wave). The sound should be short and non-intrusive.
result: [pending]

### 8. Mute toggle button in toolbar
expected: The app toolbar (header area) shows a mute toggle button with a speaker emoji. Clicking it toggles between 🔊 (unmuted) and 🔇 (muted). When muted, no audio alerts should play but visual indicators (dots, glows) still work.
result: [pending]

### 9. Mute persistence across reload
expected: Mute the audio via the toggle button, then reload the page (Ctrl+R or restart the app). After reload, the mute state should be preserved — button still shows 🔇 and no audio plays.
result: [pending]

### 10. Multiple terminals status independence
expected: Open 2+ terminal sessions. Each tile tracks its own status independently — one can be WAITING (peach) while another is WORKING (green). Status dots and glows are per-tile, not global.
result: [pending]

## Summary

total: 10
passed: 0
issues: 0
pending: 10
skipped: 0

## Gaps

[none yet]
