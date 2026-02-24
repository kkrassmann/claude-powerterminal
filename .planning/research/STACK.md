# Stack Research

**Domain:** Web-based terminal management dashboard
**Researched:** 2026-02-24
**Confidence:** HIGH

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| **Node.js** | 20+ | Runtime environment | Required for node-pty native bindings. v20+ includes native .env file support, avoiding dotenv dependency. Stable LTS with TypeScript support. |
| **TypeScript** | 5.7+ | Type safety | Current stable release with ES2024 target support. Essential for large-scale Angular + Node.js projects. Version 5.7 adds better type safety for uninitialized variables. |
| **Fastify** | 5.7+ | Backend web framework | Fastest Node.js web framework with built-in Pino logging, excellent WebSocket plugin support, TypeScript-first design. Used in reference project with proven Windows compatibility. |
| **Angular** | 21.1+ | Frontend framework | Modern Angular with standalone components by default (no NgModules needed). Signals-based reactivity, zoneless support, and strong TypeScript integration. Version 21+ is production-ready with improved performance. |
| **node-pty** | 1.1.0 | PTY process management | Microsoft-maintained library for spawning pseudo-terminals. v1.1.0 is latest stable (v1.2.0-beta exists but avoid beta for production). Windows conpty API support for Windows 11. |
| **xterm.js** | 6.0.0 | Terminal emulation | Industry-standard terminal renderer. v6.0+ uses new scoped `@xterm/*` packages for security. WebGL and fit addons provide smooth rendering and responsive sizing. |

### Backend Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| **@fastify/websocket** | 11.2+ | WebSocket support | Required for real-time terminal I/O streaming. Integrates seamlessly with Fastify's request lifecycle. |
| **@fastify/static** | 9.0+ | Serve Angular build | Serve frontend production build from `/dist`. Fastify's official static file plugin. |
| **@fastify/cors** | 11.0+ | Cross-origin support | Required for local network access from different devices (phone/tablet accessing desktop server). |
| **ws** | 8.19+ | WebSocket implementation | Peer dependency for @fastify/websocket. Provides low-level WebSocket protocol handling. |
| **simple-git** | 3.0+ | Git operations | Read working directory, current branch for terminal headers. Lightweight wrapper for Git CLI commands. v3+ supports both CommonJS and ES modules. |
| **pino** | 9.0+ | Logging | Fastify's default logger. Extremely fast, JSON-based structured logging. Use pino-pretty transport for development, raw JSON for production. |
| **tsx** | 4.0+ | TypeScript execution | Development runtime for TypeScript. 20-30x faster than ts-node via esbuild. Use for `npm run dev` with watch mode. |

### Frontend Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| **@xterm/addon-fit** | 0.10+ | Terminal auto-sizing | Required for responsive terminal tiles in grid layout. Auto-adjusts terminal dimensions to container size. |
| **@xterm/addon-webgl** | 0.18+ | Hardware acceleration | Optional but recommended for smooth rendering of 6-10 concurrent terminals. Fallback to Canvas renderer if WebGL unavailable. |
| **howler** | 2.2.4 | Audio notifications | Simple audio library for terminal status alerts. 7KB gzipped, Web Audio API with HTML5 Audio fallback. Supports all common formats (MP3, OGG, WAV). |
| **rxjs** | 7.8+ | Reactive programming | Angular's peer dependency. Use `webSocket()` subject for WebSocket connection management with auto-reconnection. |
| **@angular/material** | 21.1+ | UI components | Optional but recommended for consistent UI (buttons, menus, dialogs). Version 21+ includes time picker, 2D drag-and-drop, and Material 3 design. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| **pino-pretty** | Development log formatting | Dev dependency only. Formats JSON logs as human-readable output. Configure via Fastify transport in development mode. |
| **@types/node** | Node.js type definitions | Required for TypeScript. Use v20.0+ to match Node.js runtime. |
| **@types/ws** | WebSocket type definitions | Required for TypeScript when using ws library. |
| **Angular CLI** | Project scaffolding | Use `ng new` with standalone components, skip routing initially. Configure for production builds with AOT compilation. |

## Installation

```bash
# Backend Core
npm install fastify@^5.7.0 @fastify/websocket@^11.2.0 @fastify/static@^9.0.0 @fastify/cors@^11.0.0
npm install node-pty@^1.1.0 ws@^8.19.0 simple-git@^3.0.0 pino@^9.0.0

# Backend Dev Dependencies
npm install -D typescript@^5.7.0 tsx@^4.0.0 @types/node@^20.0.0 @types/ws@^8.18.0 pino-pretty@^12.0.0

# Frontend (Angular project)
npm install xterm@^6.0.0 @xterm/addon-fit@^0.10.0 @xterm/addon-webgl@^0.18.0
npm install howler@^2.2.4 rxjs@^7.8.0
npm install @angular/material@^21.1.0  # optional

# Frontend Dev Dependencies
npm install -D @types/howler
```

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| **Fastify** | Express.js | Never for this project. Express is slower, lacks built-in WebSocket support, and requires more middleware configuration. Fastify proven in reference project. |
| **Angular** | React / Vue | User preference + reference project alignment. React would require more WebSocket boilerplate; Vue has weaker TypeScript integration. Angular's RxJS is ideal for WebSocket streams. |
| **xterm.js** | terminal-kit, blessed | Never. xterm.js is the industry standard for web-based terminals, used by VS Code, Hyper, and others. Alternatives are CLI-focused, not web-compatible. |
| **node-pty** | pty.js | Never. pty.js is unmaintained (last update 2015). node-pty is the Microsoft-maintained successor with Windows conpty support. |
| **howler** | Tone.js, Web Audio API directly | Use Tone.js for music/synthesis. Use Web Audio API directly if you need precise timing control. Howler is simpler for notification sounds with format fallbacks. |
| **pino** | Winston, Bunyan | Use Winston if you need custom transports beyond stdout/file. Pino is 5x faster and Fastify's default. Bunyan is outdated (last major update 2018). |
| **tsx** | ts-node | Use ts-node if you need comprehensive type checking during execution. tsx is 20-30x faster via esbuild and recommended for development. Node.js v22.18+ has native TypeScript execution but still experimental. |
| **simple-git** | nodegit, isomorphic-git | Use nodegit for advanced Git operations (rebase, merge conflicts). simple-git is sufficient for read-only status/branch display. isomorphic-git adds unnecessary complexity. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| **xterm-addon-*** packages | Deprecated in xterm.js 5.4+. Security risk (typosquatting). | Use scoped `@xterm/addon-*` packages (e.g., `@xterm/addon-fit` not `xterm-addon-fit`). |
| **dotenv** | Unnecessary on Node.js 20+. Adds dependency bloat. | Use Node.js native `--env-file` flag or environment variables directly. For multi-env files, dotenv still acceptable but not required. |
| **ts-node** | 20-30x slower than tsx. Blocks development workflow. | Use `tsx` for development execution. Use `tsc` for production builds. |
| **socket.io** | Overkill for this use case. Adds 50KB+ to bundle. Requires server + client library. | Use native WebSocket with `@fastify/websocket` backend and RxJS `webSocket()` frontend. Simpler, faster, fewer dependencies. |
| **Express.js** | Slower performance, no built-in async/await support, requires multiple middleware packages. | Use Fastify. Reference project proves Windows compatibility and WebSocket patterns. |
| **Angular Universal (SSR)** | Not needed for local network dashboard. Adds complexity. | Build as SPA with AOT compilation. Server-side rendering unnecessary for this use case. |
| **NgModules** | Deprecated pattern in Angular 19+. Standalone components are default. | Use standalone components exclusively. Angular CLI scaffolds standalone by default. |

## Stack Patterns by Variant

**If targeting Windows 11 only:**
- Use node-pty v1.1.0 with conpty API (automatic on Windows 10 build 18309+)
- Configure bash shell via node-pty spawn options: `{ name: 'bash', shell: 'C:\\Program Files\\Git\\bin\\bash.exe' }`
- Test with Windows Terminal for accurate PTY output rendering

**If supporting cross-platform (Windows + macOS/Linux):**
- Use node-pty v1.1.0 (works on all platforms)
- Detect platform and configure shell path dynamically: `process.platform === 'win32' ? 'cmd.exe' : '/bin/bash'`
- Test PTY output parsing on all platforms (prompt patterns may differ)

**If local network access is required:**
- Bind Fastify to `0.0.0.0` not `localhost`: `fastify.listen({ port: 3000, host: '0.0.0.0' })`
- Configure CORS with `@fastify/cors` to allow requests from LAN devices
- Use static IP or mDNS for device discovery (e.g., `server.local`)

**If audio notifications must work on mobile:**
- Howler.js requires user gesture on mobile (autoplay policy)
- Display visual "unmute" button on first load
- Test on iOS Safari (strictest autoplay policy) and Android Chrome

**If session persistence across server restarts:**
- Store session IDs in backend (in-memory Map or file-based JSON)
- Use IndexedDB on frontend for offline tolerance (localStorage has 5MB limit, synchronous API)
- Implement reconnection logic in RxJS WebSocket with retry backoff

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| **Fastify 5.7+** | @fastify/websocket 11.2+, pino 9.0+ | Fastify 5.x requires @fastify/* plugins v11+. Do NOT mix Fastify 4.x with @fastify/* v11. |
| **Angular 21.1+** | TypeScript 5.6-5.7, RxJS 7.8+ | Angular 21 supports TypeScript 6 (experimental). Stick to TS 5.7 for stability. |
| **xterm.js 6.0** | @xterm/addon-* 0.10+ | v6 requires scoped addons. Old `xterm-addon-*` packages incompatible. |
| **node-pty 1.1.0** | Node.js 16+, Electron 19+ | Requires native build tools on Windows (Visual Studio Build Tools or similar). |
| **howler 2.2.4** | Modern browsers (Web Audio API) | IE11 not supported (falls back to HTML5 Audio, but limited features). |
| **TypeScript 5.7** | Node.js 20+ (ES2024 target) | Use `--target es2024` for modern Node.js. Compiles to `lib: ["es2024"]` for browser. |

## Sources

### Official Documentation
- [Fastify GitHub Releases](https://github.com/fastify/fastify/releases) — Verified v5.7.4 latest (Feb 2026)
- [xterm.js GitHub Releases](https://github.com/xtermjs/xterm.js/releases) — Verified v6.0.0 with scoped packages
- [Angular GitHub Releases](https://github.com/angular/angular/releases) — Verified v21.1.5 latest (Feb 2026)
- [node-pty GitHub Releases](https://github.com/microsoft/node-pty/releases) — v1.1.0 latest stable, v1.2.0-beta.11 pre-release
- [TypeScript 5.7 Release Notes](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-7.html) — ES2024 target, import rewriting

### Community Best Practices (MEDIUM confidence — verified patterns)
- [Fastify WebSocket Best Practices - VideoSDK](https://www.videosdk.live/developer-hub/websocket/fastify-websocket) — Authentication, error handling patterns
- [Better Stack: Fastify WebSockets](https://betterstack.com/community/guides/scaling-nodejs/fastify-websockets/) — Connection management, backpressure
- [Angular WebSockets with RxJS - Medium](https://medium.com/@saranipeiris17/websockets-in-angular-a-comprehensive-guide-e92ca33f5d67) — Service-based architecture, reconnection logic
- [Building Robust WebSocket with RxJS](https://craigsh.dev/blog/robust-websockets-using-rxjs/) — Error handling, reconnection patterns
- [Web Audio API Best Practices - MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices) — User control, autoplay policy
- [Better Stack: TSX vs ts-node](https://betterstack.com/community/guides/scaling-nodejs/tsx-vs-ts-node/) — Performance benchmarks, use cases
- [Pino Logger Guide - SigNoz](https://signoz.io/guides/pino-logger/) — Production configuration, redaction patterns
- [IndexedDB for Session Persistence - Turnkey](https://www.turnkey.com/blog/introducing-indexeddb-improved-session-persistence-verifiable-sessions-and-upgraded-auth-for-seamless-web-apps) — Storage patterns for session data

### Reference Implementation (HIGH confidence — proven patterns)
- `C:\Dev\claude-terminal-overseer\server\package.json` — Fastify 5.7, @fastify/websocket 11.2, node-pty 1.1.0, simple-git 3.0 (production-tested on Windows 11)

---
*Stack research for: Web-based terminal management dashboard (Claude PowerTerminal)*
*Researched: 2026-02-24*
