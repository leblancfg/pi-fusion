# pi-fusion

Standalone [pi](https://pi.dev) extension for experimenting with **LLM Fusion**: each normal user turn is rewritten into a two-stage flow:

1. Run several read-only planner workers in parallel.
2. Feed their bounded outputs to the normal actor turn, which synthesizes and acts.

This is intentionally a rough testing harness, not a polished agent workflow.

## Install

```bash
pi install git:github.com/leblancfg/pi-fusion
```

Or test locally from a checkout:

```bash
pi -e ./extensions/pi-fusion/index.ts
```

## What it does

For each idle, non-command user input, the extension:

- spawns `N` standalone `pi` subprocesses in JSON print mode;
- disables extensions in those subprocesses with `--no-extensions` to avoid recursive fusion;
- restricts worker tools to `read,grep,find,ls`;
- gives each worker the current task plus a capped slice of recent conversation context;
- asks workers to return concise planning markdown;
- transforms the original user message into an actor prompt containing:
  - the original request;
  - bounded worker outputs;
  - instructions to synthesize, verify, and act normally.

The actor is the regular pi agent in the main session, with whatever tools/settings you already selected. By default it keeps your current model, but pi-fusion can optionally switch to a configured synthesizer model before the actor turn starts.

## Worker lenses

The first stab uses a small set of planning lenses to diversify useful thinking:

- `mapper` — find relevant files/symbols/patterns;
- `planner` — propose a minimal implementation plan and verification;
- `skeptic` — look for risks, edge cases, and tests;
- `simplifier` — challenge unnecessary complexity.

If you configure more than four workers, lenses repeat.

## UI

Run `/fusion` with no arguments to open a floating settings pane.

From the pane you can tweak:

- whether fusion is enabled;
- the number of worker planners;
- the worker model;
- the synthesizer/actor model.

Keyboard controls:

```text
↑/↓       move
←/→       adjust worker count or cycle models
Enter     pick a model or save
Space     toggle enabled
Esc       cancel
```

Model rows also open a floating searchable picker with `Enter`.

## Commands

```text
/fusion                 # open floating pane
/fusion status
/fusion on
/fusion off
/fusion workers 4
/fusion worker-model anthropic/claude-sonnet-4-5
/fusion worker-model current
/fusion synthesizer-model openai/gpt-5.2-codex
/fusion synthesizer-model current
/fusion output 12000
/fusion context 16000
/fusion timeout 600000
```

`/fusion model ...` is kept as an alias for `/fusion worker-model ...`.

Settings changed through `/fusion` are persisted in the pi session via a custom entry.

## Startup flags

```bash
pi --fusion-disabled
pi --fusion-workers 3
pi --fusion-worker-model anthropic/claude-sonnet-4-5
pi --fusion-synthesizer-model openai/gpt-5.2-codex
pi --fusion-output-bytes 12000
pi --fusion-context-bytes 16000
pi --fusion-timeout-ms 600000
```

`current` or omitting a model flag means "use/keep the current main-session model". `--fusion-model` is kept as a backwards-compatible alias for `--fusion-worker-model`.

## Bypasses

Fusion is skipped for:

- slash commands and prompt templates (`/...`);
- user bash (`!...`);
- extension-injected input;
- steering/follow-up messages queued while the agent is running;
- prompts that are already fusion actor prompts.

These skips keep the first version predictable and avoid recursion.

## Context budget

Worker output inserted into the main actor prompt is capped per worker (`fusion-output-bytes`, default `12000`). Recent conversation context sent to each worker is separately capped (`fusion-context-bytes`, default `16000`). Prior fusion actor bundles are skipped when building worker context so the session does not recursively balloon.

Full worker transcripts are not stored separately yet. The main session only sees the bounded actor prompt.

## Rough edges to watch

- Workers are subprocesses, not true session forks. They receive a truncated text snapshot of recent conversation instead of the exact pi session tree.
- Planner workers do not see attached images. The actor prompt warns the actor when images are present.
- Worker subprocesses still load normal pi context files (`AGENTS.md`) but not extensions.
- Worker planning blocks the input turn until all workers finish or time out.
- Worker tool access is intentionally very narrow: no `bash`, no write/edit.
- Print/JSON/RPC modes should work in principle, but the extension is mostly designed for interactive testing.

## Development

```bash
pnpm install
pnpm test
pnpm run typecheck
```

## Package shape

This package is standalone. It does not depend on the pi subagent example or any other extension.

```json
{
  "pi": {
    "extensions": ["./extensions/pi-fusion/index.ts"]
  }
}
```
