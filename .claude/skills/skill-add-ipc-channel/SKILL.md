---
name: skill-add-ipc-channel
description: Boilerplate generator for new IPC channels — adds constant, handler, HTTP endpoint, and Angular service method.
argument-hint: "CONSTANT_NAME \"Description of the channel\""
---

# Add IPC Channel

Generates the full boilerplate for a new IPC channel across all four layers of the dual-transport architecture.

## Input

`$ARGUMENTS` contains the channel name and description:
- Format: `CONSTANT_NAME "Description"` (e.g., `SESSION_EXPORT "Export session logs to file"`)
- The constant name uses UPPER_SNAKE_CASE
- If `$ARGUMENTS` is missing or unclear, use `AskUserQuestion` to clarify

## Naming Derivation

From the constant name, derive all identifiers:

| Input              | Example                  |
|--------------------|--------------------------|
| Constant           | `SESSION_EXPORT`         |
| Channel value      | `session:export`         |
| HTTP path          | `/api/session-export`    |
| Method name        | `sessionExport`          |
| Handler file       | `session-handlers.ts`    |

Rules:
- Channel value: lowercase, first word is domain prefix, joined by `:` (e.g., `PTY_LIST` -> `pty:list`)
- HTTP path: `/api/` + lowercase words joined by `-` (e.g., `SESSION_EXPORT` -> `/api/session-export`)
- Method name: camelCase of words (e.g., `SESSION_EXPORT` -> `sessionExport`)
- Handler file: domain prefix determines file:
  - `PTY_*` -> `electron/ipc/pty-handlers.ts`
  - `SESSION_*` -> `electron/ipc/session-handlers.ts`
  - `GIT_*` -> `electron/ipc/git-handlers.ts`
  - `APP_*` -> `electron/main.ts`
  - `LOG_*` or `ANALYSIS_*` -> `electron/ipc/analysis-handlers.ts`
  - Unknown prefix -> ask user via `AskUserQuestion`

## Ablauf

### Step 1: Parse Arguments

Extract `CONSTANT_NAME` and `"description"` from `$ARGUMENTS`. Derive all identifiers using the naming rules above. If the prefix doesn't map to a known handler file, ask the user.

### Step 2: Read Target Files

Read these 4 files to understand current state and find insertion points:
1. `src/shared/ipc-channels.ts` — find the `} as const;` closing line
2. The target handler file (e.g., `electron/ipc/session-handlers.ts`) — find the register function
3. `electron/http/static-server.ts` — find the static file fallback section
4. An Angular service that matches the domain (or `src/src/app/services/session-manager.service.ts` as default)

Also read `electron/preload.ts` to add the channel to the validChannels array.

### Step 3: Edit `src/shared/ipc-channels.ts`

Insert the new constant before `} as const;`:

```typescript
  // {description}
  {CONSTANT_NAME}: '{channel:value}',
```

**Reference:** Look at existing entries for formatting. Insert in the appropriate section (grouped by domain prefix).

### Step 4: Edit Handler File

Add a new `ipcMain.handle()` inside the existing `register*Handlers()` function:

```typescript
  // Handler: {CONSTANT_NAME} - {description}
  ipcMain.handle(IPC_CHANNELS.{CONSTANT_NAME}, async (_event, ...args: any[]) => {
    // TODO: Implement {description}
    console.log('[{Domain} Handlers] {CONSTANT_NAME} called');
    return { success: true };
  });
```

**Reference:** Follow the pattern in `electron/ipc/session-handlers.ts` — each handler uses `IPC_CHANNELS.X`, has a try/catch, and returns `{ success: boolean }`.

### Step 5: Edit `electron/http/static-server.ts`

Add HTTP endpoint BEFORE the static file fallback (before `let filePath = req.url === '/'`):

```typescript
    // GET {http_path} - {description}
    if (req.method === 'GET' && pathname === '{http_path}') {
      try {
        // TODO: Implement {description}
        res.writeHead(200, corsHeaders);
        res.end(JSON.stringify({ success: true }));
      } catch (error: any) {
        res.writeHead(500, corsHeaders);
        res.end(JSON.stringify({ error: String(error) }));
      }
      return;
    }

```

**Reference:** Follow the pattern of existing endpoints like `/api/analysis` in the same file.

### Step 6: Edit `electron/preload.ts`

Add the new channel string to the `validChannels` array so it passes the security whitelist.

### Step 7: Edit Angular Service

Add a dual-mode method to the appropriate Angular service:

```typescript
  /**
   * {description}
   */
  async {methodName}(): Promise<any> {
    try {
      if (window.electronAPI) {
        return await window.electronAPI.invoke(IPC_CHANNELS.{CONSTANT_NAME});
      } else {
        const resp = await fetch(`http://${window.location.hostname}:9801{http_path}`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return await resp.json();
      }
    } catch (error: any) {
      console.warn('[Service] {methodName} failed:', error.message);
      return null;
    }
  }
```

**Reference:** Follow the pattern in `src/src/app/services/log-analysis.service.ts` — dual-mode with `window.electronAPI` check and HTTP fallback.

### Step 8: Summary

Output a summary of all changes:

```
IPC Channel Added: {CONSTANT_NAME}
====================================
[1] src/shared/ipc-channels.ts       — Added constant {CONSTANT_NAME}: '{channel:value}'
[2] electron/ipc/{handler-file}      — Added ipcMain.handle() stub
[3] electron/http/static-server.ts   — Added GET {http_path} endpoint
[4] electron/preload.ts              — Added to validChannels whitelist
[5] src/src/app/services/{service}   — Added {methodName}() dual-mode method

All stubs contain TODO comments. Implement the business logic next.
```

## Important Rules

- **Always use IPC_CHANNELS constant** — never hardcode channel strings
- **All stubs have TODO comments** — this skill scaffolds, doesn't implement logic
- **Follow existing patterns exactly** — match indentation, naming, error handling style
- **Don't modify unrelated code** — only add the new channel's boilerplate
- **Preload whitelist is critical** — without it, the channel will be silently blocked in Electron
