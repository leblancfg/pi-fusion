# Contributing to pi-fusion

Thanks for helping out. pi-fusion is a small, standalone pi extension, so the
contribution loop is deliberately lightweight.

## Setup

```bash
pnpm install
```

Node 20+ is required (see `.nvmrc`). pnpm is the package manager (pinned via
`packageManager` in `package.json`).

## Local checks

Run everything CI runs with a single command before you push:

```bash
pnpm run check
```

That runs, in order:

| Step   | Command                 | What it checks                                           |
| ------ | ----------------------- | -------------------------------------------------------- |
| Format | `pnpm run format:check` | Prettier formatting (`.prettierrc.json`)                 |
| Lint   | `pnpm run lint`         | ESLint + typescript-eslint                               |
| Types  | `pnpm run typecheck`    | `tsc --noEmit`                                           |
| Tests  | `pnpm test`             | unit tests in `tests/`                                   |
| Smoke  | `pnpm run smoke`        | extension loads and registers its flags/command/handlers |

Autofix formatting with `pnpm run format`.

The smoke test (`scripts/smoke.ts`) loads the extension against a stubbed
`ExtensionAPI` and asserts it registers the expected flags, the `/fusion`
command, and the `session_start` / `input` / `before_agent_start` handlers. It
needs no API key, so it runs in CI.

For an interactive end-to-end check, load the extension against real `pi`:

```bash
pi -e ./extensions/pi-fusion/index.ts            # fusion enabled
pi -e ./extensions/pi-fusion/index.ts --fusion-disabled -p "say hi"   # gate only, no fanout
```

## Project layout

```
extensions/pi-fusion/
  fusion.ts   # pure logic: settings, prompts, parsing, bypass (unit-tested)
  index.ts    # orchestration: subprocess fanout, lifecycle hooks, commands
  ui.ts       # TUI: settings pane and live worker panel
tests/        # node:test unit tests for fusion.ts
scripts/      # smoke.ts
```

Keep pure, testable logic in `fusion.ts` and cover it in `tests/`. `index.ts`
and `ui.ts` are harder to unit-test, so lean on `typecheck`, the smoke test, and
manual TUI runs.

## Commits and PRs

- One logical change per commit, with a terse but descriptive message.
- Write a test first when the change is testable, and make sure
  `pnpm run check` is green before you commit.
- Keep PRs focused; push early and often.
