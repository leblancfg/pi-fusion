# pi-fusion

Standalone [pi](https://pi.dev) extension for experimenting with **LLM Fusion**: each normal user turn is rewritten into a multi-stage flow:

1. Run a read-only discovery agent to gather reusable context.
2. Run a quick query-rewrite pass to produce complementary worker prompts.
3. Run several read-only planner workers in parallel.
4. Feed discovery context and bounded worker outputs to the normal actor turn, which synthesizes and acts.

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

- opens a live floating discovery pane in TUI mode;
- runs query rewriting in parallel to discovery without its own pane;
- after discovery finishes, replaces the discovery pane with live worker splits;
- spawns standalone `pi` subprocesses in JSON print mode;
- streams each visible subprocess's reasoning deltas, tool events, and output into its pane/column as JSON events arrive;
- disables extensions in those subprocesses with `--no-extensions` to avoid recursive fusion;
- runs discovery with read/search tools (`read,grep,find,ls`) and captures both its summary and tool-result context;
- runs query rewriting with no tools using the worker model;
- gives each numbered worker (`#1`, `#2`, `#3`, ...) the original task, recent context, shared discovery context, and one rewritten exploration prompt;
- asks workers to return concise planning markdown;
- transforms the original user message into an actor prompt containing:
  - the original request;
  - shared discovery context;
  - prompt variations;
  - bounded worker outputs;
  - instructions to synthesize, verify, and avoid redundant tool calls.

The actor is the regular pi agent in the main session, with whatever tools/settings you already selected. By default it keeps your current model, but pi-fusion can optionally switch to a configured synthesizer model before the actor turn starts.

## Discovery and query rewriting

Discovery is a tunable first step with its own model and reasoning effort. Its job is to spend tool calls once, up front, and produce reusable context for the worker fanout and synthesizer.

The rewrite step is a quick no-tool call using the worker model. It runs in parallel with discovery and rewrites the user request into one complementary exploration prompt per worker, similar to query expansion in RAG. Workers are numbered (`#1`, `#2`, `#3`, ...) rather than assigned editorial personas, and each worker pane shows its rewritten prompt at the top.

## UI

Run `/fusion` with no arguments to open a floating settings pane.

From the pane you can tweak:

- whether fusion is enabled;
- the number of worker planners;
- the discovery model;
- the discovery reasoning effort;
- the worker model;
- the worker reasoning effort;
- the synthesizer/actor model;
- the synthesizer/actor reasoning effort.

Keyboard controls:

```text
↑/↓       move
←/→       adjust worker count or cycle model/reasoning values
Enter     pick a model or save
Space     toggle enabled
Esc       cancel
```

Model rows also open a floating searchable picker with `Enter`.

## Live planner splits

In TUI mode, each fused turn first shows a floating discovery pane by itself. When discovery finishes, the UI switches to worker vertical splits:

- each worker gets its own column;
- each worker header shows elapsed runtime and time since last update;
- child process PIDs appear as lightweight events so you can see subprocesses start;
- each worker column preloads the rewritten exploration prompt at the top;
- reasoning streams into the `reasoning` section when the selected provider/model exposes thinking deltas;
- assistant text streams into the `output` section;
- read/search tool calls show as lightweight `→ tool` events.

The rewrite step is hidden because it is just prompt preparation and runs in parallel with discovery. Press `Esc` while a panel is focused to hide it without cancelling the subprocesses. The worker pane closes automatically when the planning pass finishes and the actor turn starts.

## Commands

```text
/fusion                 # open floating pane
/fusion status
/fusion on
/fusion off
/fusion workers 4
/fusion discovery-model anthropic/claude-haiku-4-5
/fusion discovery-model current
/fusion discovery-thinking low
/fusion discovery-thinking current
/fusion worker-model anthropic/claude-sonnet-4-5
/fusion worker-model current
/fusion worker-thinking high
/fusion worker-thinking current
/fusion synthesizer-model openai/gpt-5.2-codex
/fusion synthesizer-model current
/fusion synthesizer-thinking xhigh
/fusion synthesizer-thinking current
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
pi --fusion-discovery-model anthropic/claude-haiku-4-5
pi --fusion-discovery-thinking low
pi --fusion-worker-model anthropic/claude-sonnet-4-5
pi --fusion-worker-thinking high
pi --fusion-synthesizer-model openai/gpt-5.2-codex
pi --fusion-synthesizer-thinking xhigh
pi --fusion-output-bytes 12000
pi --fusion-context-bytes 16000
pi --fusion-timeout-ms 600000
```

`current` or omitting a model/thinking flag means "use/keep the current main-session value". `--fusion-model` is kept as a backwards-compatible alias for `--fusion-worker-model`.

Reasoning effort values are:

```text
current, off, minimal, low, medium, high, xhigh
```

## Bypasses

Fusion is skipped for:

- slash commands and prompt templates (`/...`);
- user bash (`!...`);
- extension-injected input;
- steering/follow-up messages queued while the agent is running;
- prompts that are already fusion actor prompts.

These skips keep the first version predictable and avoid recursion.

## Context budget

Worker output inserted into the main actor prompt is capped per worker (`fusion-output-bytes`, default `12000`). Recent conversation context sent to discovery/workers is separately capped (`fusion-context-bytes`, default `16000`). Prior fusion actor bundles are skipped when building worker context so the session does not recursively balloon. Discovery tool-result context is bounded internally before being shared downstream.

Full worker transcripts are not stored separately yet. The main session only sees the bounded actor prompt.

## Rough edges to watch

- Discovery/workers/rewrite are subprocesses, not true session forks. They receive a truncated text snapshot of recent conversation instead of the exact pi session tree.
- Discovery and planner workers do not see attached images. The actor prompt warns the actor when images are present.
- Worker subprocesses still load normal pi context files (`AGENTS.md`) but not extensions.
- Discovery, rewrite, and worker planning block the input turn until the fanout finishes or times out.
- The live split pane only appears in TUI mode; print/JSON/RPC still run fusion without that UI.
- Some providers/models hide chain-of-thought, so a worker column may show no reasoning stream even when reasoning effort is enabled.
- Discovery/worker tool access is intentionally very narrow: no `bash`, no write/edit.
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
