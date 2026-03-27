---
status: diagnosed
trigger: "Cache-hit ratio always shows 0"
created: 2026-02-27T22:00:00Z
updated: 2026-02-27T22:05:00Z
---

## Current Focus

hypothesis: Parser looks for `parsed.usage` at top level, but actual JSONL has usage nested inside `parsed.message.usage`
test: Compare parser field access vs actual JSONL structure
expecting: Mismatch confirms root cause
next_action: Document root cause and fix

## Symptoms

expected: Cache-hit ratio shows real percentage, token counts show actual values
actual: Cache-hit ratio shows 0%, token numbers all 0
errors: None (silent failure - fields simply not found)
reproduction: Open analysis panel, check Token-Verbrauch section
started: Since implementation

## Eliminated

(none needed - root cause found on first hypothesis)

## Evidence

- timestamp: 2026-02-27T22:02:00Z
  checked: log-analyzer.ts lines 179-185 - token usage extraction logic
  found: |
    Parser checks `parsed.usage` (top-level field):
    ```
    if (parsed.usage) {
      stats.tokenInput += parsed.usage.input_tokens || 0;
      stats.tokenOutput += parsed.usage.output_tokens || 0;
      stats.tokenCacheRead += parsed.usage.cache_read_input_tokens || 0;
      stats.tokenCacheCreation += parsed.usage.cache_creation_input_tokens || 0;
    }
    ```
  implication: Parser expects `usage` as a top-level field on the JSONL object

- timestamp: 2026-02-27T22:03:00Z
  checked: Actual JSONL file structure (session 35458361)
  found: |
    Real structure has usage NESTED inside `message`:
    ```json
    {
      "type": "assistant",
      "message": {
        "role": "assistant",
        "content": [...],
        "usage": {
          "input_tokens": 2,
          "cache_creation_input_tokens": 21651,
          "cache_read_input_tokens": 19748,
          "output_tokens": 265,
          ...
        }
      }
    }
    ```
    There is NO top-level `parsed.usage` field.
    The usage object lives at `parsed.message.usage`.
  implication: The `if (parsed.usage)` check ALWAYS evaluates to falsy => zero tokens accumulated

- timestamp: 2026-02-27T22:04:00Z
  checked: Whether tool_use detection has the same nesting issue
  found: |
    Tool detection at line 169 correctly accesses `parsed.message.content`:
    ```
    if (parsed.type === 'assistant' && Array.isArray(parsed.message?.content)) {
    ```
    So tool counts work fine. Only the usage extraction is wrong.
  implication: Inconsistency in the parser - tool detection uses correct path, token detection does not

## Resolution

root_cause: |
  Field path mismatch in `parseJsonlFile()` at line 180.
  The parser accesses `parsed.usage` but actual JSONL structure nests usage at `parsed.message.usage`.
  The `if (parsed.usage)` guard always evaluates to undefined/falsy, so the token accumulation block
  (lines 181-184) never executes. All token counters stay at 0, producing a 0% cache-hit ratio.

fix: |
  Change line 180 from `if (parsed.usage)` to `if (parsed.message?.usage)`,
  and change all references from `parsed.usage.X` to `parsed.message.usage.X`:

  ```typescript
  // Line 180-185: Change from:
  if (parsed.usage) {
    stats.tokenInput += parsed.usage.input_tokens || 0;
    stats.tokenOutput += parsed.usage.output_tokens || 0;
    stats.tokenCacheRead += parsed.usage.cache_read_input_tokens || 0;
    stats.tokenCacheCreation += parsed.usage.cache_creation_input_tokens || 0;
  }

  // To:
  const usage = parsed.message?.usage;
  if (usage) {
    stats.tokenInput += usage.input_tokens || 0;
    stats.tokenOutput += usage.output_tokens || 0;
    stats.tokenCacheRead += usage.cache_read_input_tokens || 0;
    stats.tokenCacheCreation += usage.cache_creation_input_tokens || 0;
  }
  ```

verification: pending
files_changed:
  - electron/analysis/log-analyzer.ts
