---
name: skill-new-component
description: Scaffolds a new Angular standalone component with Catppuccin Mocha theme styles.
argument-hint: "component-name-in-kebab-case"
---

# New Angular Component

Creates a new standalone Angular component with Catppuccin Mocha theme styling, matching the project's existing patterns.

## Input

`$ARGUMENTS` contains the component name in kebab-case (e.g., `task-board`).

If `$ARGUMENTS` is missing or not in kebab-case, use `AskUserQuestion` to ask for the component name.

## Naming Derivation

| Input (kebab-case) | Derived                         |
|---------------------|---------------------------------|
| `task-board`        | Class: `TaskBoardComponent`     |
| `task-board`        | Selector: `app-task-board`      |
| `task-board`        | Directory: `task-board/`        |

Rules:
- Class name: PascalCase + `Component` suffix
- Selector: `app-` prefix + original kebab-case
- Files go in `src/src/app/components/{kebab-name}/`

## Ablauf

### Step 1: Validate

- Check that `$ARGUMENTS` is valid kebab-case
- Check that `src/src/app/components/{name}/` does NOT already exist (abort if it does)

### Step 2: Create TypeScript file

Write `src/src/app/components/{name}/{name}.component.ts`:

```typescript
import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-{kebab-name}',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './{kebab-name}.component.html',
  styleUrls: ['./{kebab-name}.component.css'],
})
export class {PascalName}Component implements OnInit, OnDestroy {
  private subscriptions = new Subscription();

  ngOnInit(): void {
    // TODO: Initialize component
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }
}
```

### Step 3: Create HTML template

Write `src/src/app/components/{name}/{name}.component.html`:

```html
<div class="{kebab-name}-container">
  <h3>{PascalName}</h3>
  <!-- TODO: Component content -->
</div>
```

### Step 4: Create CSS file

Write `src/src/app/components/{name}/{name}.component.css`:

```css
/* Catppuccin Mocha theme */
:host {
  display: block;
}

.{kebab-name}-container {
  background: #1e1e2e;
  border: 1px solid #313244;
  border-radius: 12px;
  padding: 16px;
  color: #cdd6f4;
  font-family: 'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'Consolas', monospace;
}

h3 {
  margin: 0 0 12px 0;
  font-size: 14px;
  font-weight: 600;
  color: #cdd6f4;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
```

### Step 5: Summary

Output:

```
Component Created: {PascalName}Component
=========================================
[1] src/src/app/components/{name}/{name}.component.ts   — Standalone component with OnInit/OnDestroy
[2] src/src/app/components/{name}/{name}.component.html  — Minimal template with container
[3] src/src/app/components/{name}/{name}.component.css   — Catppuccin Mocha base styles

Next steps:
- Import in parent component or add to routing
- Implement component logic and template
```

## Important Rules

- **Standalone components only** — no NgModules (Angular 17+ pattern)
- **Catppuccin Mocha colors** — `#1e1e2e` base, `#313244` surface0, `#cdd6f4` text
- **Monospace font stack** — Cascadia Code, Fira Code, JetBrains Mono, Consolas
- **No parent registration** — the component is created standalone, user decides where to use it
- **Subscription cleanup** — always include OnDestroy with subscription management
