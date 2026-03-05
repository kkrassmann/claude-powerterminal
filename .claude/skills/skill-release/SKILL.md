---
name: skill-release
description: Interactive release workflow — version bump, changelog generation, local test gate, tag & GitHub draft release.
argument-hint: "1.1.0"
---

# Release Workflow

Automates the full release process: version bump, changelog generation, local build+test with human approval gate, and GitHub draft release creation.

## Input

`$ARGUMENTS` contains the target version (e.g., `1.1.0`).
- If `$ARGUMENTS` is missing or not a valid semver, use `AskUserQuestion` to ask for the version.

## Ablauf

### Phase 1: Preparation

1. **Validate preconditions** — run these checks via Bash:

   a. **Clean git state:**
      ```bash
      git status --porcelain
      ```
      If output is non-empty, STOP and tell the user to commit or stash changes first.

   b. **On main branch:**
      ```bash
      git branch --show-current
      ```
      If not `main`, STOP and tell the user to switch to main first.

   c. **Tag not already used:**
      ```bash
      git tag -l "v{VERSION}"
      ```
      If output is non-empty, STOP and tell the user that `v{VERSION}` already exists.

   d. **Up to date with remote:**
      ```bash
      git fetch origin main && git log HEAD..origin/main --oneline
      ```
      If output is non-empty, STOP and tell the user to pull first.

2. **Read current version** from `package.json` to confirm the bump makes sense (not a downgrade).

3. **Collect changelog entries** — get commits since last tag:
   ```bash
   git log $(git describe --tags --abbrev=0 2>/dev/null || git rev-list --max-parents=0 HEAD)..HEAD --pretty=format:"%H %s" --no-merges
   ```

4. **Categorize commits** by Conventional Commit prefix:
   - `feat:` / `feat(scope):` → **Features**
   - `fix:` / `fix(scope):` → **Bug Fixes**
   - `perf:` / `perf(scope):` → **Performance**
   - Skip: `chore:`, `docs:`, `refactor:`, `style:`, `ci:`, `test:`, `build:` (not user-facing)
   - Commits without a recognized prefix → **Other Changes**

   For each entry: strip the prefix, capitalize the first letter, append short hash `({SHORT_HASH})`.

5. **Show release plan** to the user and ask for confirmation via `AskUserQuestion`:
   ```
   Release v{VERSION}
   ==================
   Current version: {CURRENT}
   New version: {VERSION}

   Changelog entries:
   ### Features
   - Add worktree management (abc1234)
   - ...

   ### Bug Fixes
   - Fix session restore race condition (def5678)
   - ...

   Proceed with release?
   ```
   Options: "Yes, proceed" / "Abort release"

   If user aborts, stop immediately.

### Phase 2: Version Bump & Changelog

1. **Bump `package.json`** — use Edit tool to change the `"version"` field to `{VERSION}`.

2. **Bump `launcher/package.json`** — use Edit tool to change the `"version"` field to the same `{VERSION}`. This is critical: the launcher uses its version to download the correct GitHub release binary.

3. **Create or update `CHANGELOG.md`**:

   - **If file does not exist**, create it with this structure:
     ```markdown
     # Changelog

     All notable changes to this project will be documented in this file.
     Format based on [Keep a Changelog](https://keepachangelog.com/).

     ## [{{VERSION}}] - {{YYYY-MM-DD}}

     ### Features

     - Entry one (abc1234)

     ### Bug Fixes

     - Entry two (def5678)
     ```

   - **If file exists**, read it and insert the new version section **after** the header paragraph and **before** the first existing `## [` section. Preserve all existing content.

   - Only include category sections (Features, Bug Fixes, Performance, Other Changes) that have entries. Do not add empty sections.

4. **Check README.md feature list**:
   - Read `README.md` and locate the feature list section.
   - Compare new `feat:` commits against the documented features.
   - If new features are clearly missing from the feature list, update it. Use Edit tool.
   - If unsure whether a feature warrants a README update, skip it — don't add noise.

### Phase 3: Build & Local Test (STOP-Punkt)

1. **Build and test** — run in parallel via Bash:

   a. **Full build:**
      ```bash
      npm run build
      ```

   b. **Test suite:**
      ```bash
      npm test
      ```

   If either fails, STOP and show the error. Do not proceed.

2. **Build Windows executable:**
   ```bash
   npm run dist:win
   ```

3. **Show the user the executable path** and ask for manual testing via `AskUserQuestion`:
   ```
   Windows executable built:
   release/claude-powerterminal-{VERSION}-win-x64.exe

   Please test the executable and confirm it works correctly.
   ```
   Options: "Tested and working — proceed to publish" / "Issues found — abort release"

   **CRITICAL:** Do NOT proceed to Phase 4 without explicit user approval. This is the human-in-the-loop gate.

   If user reports issues, STOP immediately. The version bump and changelog are local-only at this point and can be reverted.

### Phase 4: Tag & Publish

1. **Stage and commit** all release changes:
   ```bash
   git add package.json launcher/package.json CHANGELOG.md
   ```
   Also stage `README.md` if it was modified in Phase 2.

   Commit message:
   ```
   chore: release v{VERSION}
   ```

2. **Create lightweight tag** (matching existing convention):
   ```bash
   git tag v{VERSION}
   ```

3. **Push to remote:**
   ```bash
   git push origin main && git push origin v{VERSION}
   ```

4. **Create GitHub draft release** with changelog as body:
   ```bash
   gh release create v{VERSION} --title "v{VERSION}" --notes "{CHANGELOG_BODY}" --draft
   ```
   Where `{CHANGELOG_BODY}` is the content of the new version section from CHANGELOG.md (without the `## [version]` header line). Use a heredoc to pass multi-line notes.

5. **Optionally upload local executable** to the draft release immediately:
   ```bash
   gh release upload v{VERSION} "release/claude-powerterminal-{VERSION}-win-x64.exe" --clobber
   ```

6. **Inform the user** about next steps:
   ```
   RELEASE v{VERSION} — DONE
   =========================
   [OK] Version bumped in package.json + launcher/package.json
   [OK] CHANGELOG.md updated
   [OK] Committed: chore: release v{VERSION}
   [OK] Tag v{VERSION} pushed
   [OK] GitHub draft release created

   Next steps:
   1. Wait for CI to finish building Win + Linux binaries
      → Check: gh run list --limit 1
   2. Once CI is green, publish the release:
      → gh release edit v{VERSION} --draft=false
   3. Publishing triggers npm publish for the launcher package
   ```

## Important Rules

- **Never skip Phase 3 → Phase 4 gate.** The user MUST explicitly confirm the executable works.
- **Always bump both package.json files** to the same version. Drift breaks `npx claude-powerterminal`.
- **Use lightweight tags** — no annotated tags. This matches the existing convention.
- **On any error, stop immediately.** Do not attempt automatic recovery or rollback. Report what happened and let the user decide.
- **Derive changelog entries from actual commits.** Never invent or embellish entries.
- **Always create the release as draft.** The npm publish workflow triggers on the `released` event, which only fires when the draft is published. Premature publishing before CI uploads binaries would break the launcher download.
- **Commit message format:** `chore: release v{VERSION}` — matches existing tag convention.
- **Date format in CHANGELOG.md:** `YYYY-MM-DD` (ISO 8601).
