# Claude Project Configuration Audit Rules

Machine-parseable rule checklist for the audit engine.
Each RULE block defines one heuristic check applied against project configuration files.
Format: ### RULE {CATEGORY}-{NN} followed by **Key:** Value pairs.

## CLAUDE.md Rules

### RULE CMD-01
**Category:** claude-md
**Severity:** warning
**Check:** file-exists
**Pattern:** CLAUDE.md
**Fix:** Add a CLAUDE.md file in the project root. This is the primary guidance file Claude reads at the start of every session.

### RULE CMD-02
**Category:** claude-md
**Severity:** anti-pattern
**Check:** length-check
**Min:** 20
**Max:** 800
**Fix:** CLAUDE.md should be 20-800 lines. Too short means insufficient guidance. Too long means Claude may skip or truncate sections.

### RULE CMD-03
**Category:** claude-md
**Severity:** tip
**Check:** section-exists
**Pattern:** ## (Build|Commands|Run|Setup)
**Fix:** Add a "## Build & Run Commands" section listing how to build, test, and run the project. Claude uses this constantly.

### RULE CMD-04
**Category:** claude-md
**Severity:** warning
**Check:** section-exists
**Pattern:** ## (Critical|Rules|MUST|Wichtig|NEVER)
**Fix:** Add a "## Critical Rules" or "## MUST" section for non-negotiable conventions. Without it, Claude guesses.

### RULE CMD-05
**Category:** claude-md
**Severity:** tip
**Check:** content-regex
**Pattern:** (NEVER|ALWAYS|MUST|never|always|must)
**Fix:** Use strong directive language (NEVER, ALWAYS, MUST) to make rules unambiguous for Claude. Soft suggestions are often ignored.

### RULE CMD-06
**Category:** claude-md
**Severity:** tip
**Check:** section-exists
**Pattern:** ## (Tech Stack|Stack|Dependencies|Technologie)
**Fix:** Add a "## Tech Stack" section listing key dependencies and versions. This prevents Claude from suggesting outdated alternatives.

### RULE CMD-07
**Category:** claude-md
**Severity:** warning
**Check:** content-regex
**Pattern:** (test|Test|TEST|spec|Spec)
**Fix:** Document how to run tests in CLAUDE.md. Claude needs to know the test command to verify its own changes.

## Skill Rules

### RULE SKL-01
**Category:** skill
**Severity:** warning
**Check:** section-exists
**Pattern:** ^---
**Fix:** Add YAML frontmatter (---) block with name, description, and allowed-tools fields. Without frontmatter, Claude may not recognize this as a skill.

### RULE SKL-02
**Category:** skill
**Severity:** tip
**Check:** content-regex
**Pattern:** description:
**Fix:** Add a "description:" field in frontmatter so Claude knows when to invoke this skill automatically.

### RULE SKL-03
**Category:** skill
**Severity:** tip
**Check:** content-regex
**Pattern:** (allowed-tools:|tools:)
**Fix:** Add an "allowed-tools:" list to restrict which tools this skill can use. Unrestricted skills are harder to reason about and may use unnecessary tools.

## Agent Rules

### RULE AGT-01
**Category:** agent
**Severity:** warning
**Check:** section-exists
**Pattern:** ^---
**Fix:** Add YAML frontmatter with name, description, and tools fields. Without frontmatter, this agent definition may not be parsed correctly by Claude.

### RULE AGT-02
**Category:** agent
**Severity:** warning
**Check:** content-regex
**Pattern:** tools:
**Fix:** Define a "tools:" list to restrict which tools this agent can use. Unrestricted agents have unbounded capabilities and are harder to control.

### RULE AGT-03
**Category:** agent
**Severity:** warning
**Check:** content-regex
**Pattern:** (<role>|## Role|## Goal|## Responsibilities)
**Fix:** Add a clear <role> block or ## Role/## Goal section defining what this agent does and its boundaries.

### RULE AGT-04
**Category:** agent
**Severity:** tip
**Check:** length-check
**Min:** 10
**Max:** 400
**Fix:** Agent definitions should be 10-400 lines. Too short means vague role. Too long means the agent prompt itself consumes too much context.

## MCP Server Config Rules

### RULE MCP-01
**Category:** mcp
**Severity:** warning
**Check:** content-regex
**Pattern:** (mcpServers|mcp_servers|"mcp")
**Fix:** MCP config should define at least one mcpServers entry. An empty config file provides no value.

### RULE MCP-02
**Category:** mcp
**Severity:** tip
**Check:** content-regex
**Pattern:** "command":\s*"
**Fix:** Each MCP server entry needs a "command" field pointing to the server executable. Without it, Claude cannot launch the server.

### RULE MCP-03
**Category:** mcp
**Severity:** tip
**Check:** content-regex
**Pattern:** "args":\s*\[
**Fix:** Add an "args" array to each MCP server entry specifying the launch arguments. Required for most MCP server implementations.
