# pi-fusion

Standalone [pi](https://pi.dev) extension for experimenting with **LLM Fusion**: each normal user turn is expanded into a multi-stage flow:

1. Run a read-only discovery agent to gather reusable context.
2. Run a quick query-rewrite pass, where the model decides how many complementary worker prompts the task warrants.
3. Run those read-only planner workers in parallel.
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
- injects shared discovery context at the top of each worker prompt, before worker-specific instructions or rewrites;
- gives each numbered worker (`#1`, `#2`, `#3`, ...) the original task, recent context, and one rewritten exploration prompt;
- asks workers to return concise planning markdown;
- leaves the user's message untouched in the session, and instead injects the planning bundle into that turn's system prompt (via `before_agent_start`) containing:
  - the original request;
  - shared discovery context;
  - prompt variations;
  - bounded worker outputs;
  - instructions to synthesize, verify, and avoid redundant tool calls.

Because the bundle goes into the per-turn system prompt rather than the user message, `/tree` and `/fork` still show your original prompt, and the heavy planning context does not persist across turns.

The actor is the regular pi agent in the main session, with whatever tools/settings you already selected. By default it keeps your current model, but pi-fusion can optionally switch to a configured synthesizer model before the actor turn starts.

## Discovery and query rewriting

Discovery is a tunable first step with its own model and reasoning effort. Its job is to spend tool calls once, up front, and produce reusable context for the worker fanout and synthesizer.

The rewrite step is a quick no-tool call using the worker model. It runs in parallel with discovery and rewrites the user request into complementary exploration prompts, similar to query expansion in RAG. The extension is not opinionated about personas or counts: the rewrite model decides how many prompts (and therefore how many workers) the task warrants, up to the configured max-workers cap. The fanout, live panel, and status are sized from what the model returns. Workers are numbered (`#1`, `#2`, `#3`, ...) rather than assigned editorial personas, and each worker pane can show its rewritten prompt.

## UI

Run `/fusion` with no arguments to open a floating settings pane.

From the pane you can tweak:

- whether fusion is enabled (this applies immediately, even if you close the pane with `Esc`);
- the max number of worker planners (a ceiling; the rewrite model picks the actual count);
- the discovery model;
- the discovery reasoning effort;
- the worker model;
- the worker reasoning effort;
- the synthesizer/actor model;
- the synthesizer/actor reasoning effort.

Keyboard controls:

```text
↑/↓       move
←/→       adjust max workers or cycle model/reasoning values
Enter     pick a model or save
Space     toggle enabled (applies immediately)
Esc       cancel (the enabled toggle still sticks)
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

Panel controls:

```text
1-9   zoom a single worker column to full width
0/Tab restore the split view
p     toggle the rewritten-prompt block (collapsed by default)
Esc   cancel the fanout (kills the subprocesses) and fall back to a normal turn
```

When the per-column width would drop below ~24 characters, the panel automatically degrades to a single focused column so output stays legible; use `1-9` to switch which worker is shown. The rewrite step is hidden because it is just prompt preparation and runs in parallel with discovery. The worker pane closes automatically when the planning pass finishes and the actor turn starts.

## Commands

```text
/fusion                 # open floating pane
/fusion status
/fusion on
/fusion off
/fusion workers 4         # max workers (cap); the rewrite model picks the actual count
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
pi --fusion-workers 3            # max workers (cap), not a fixed count
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

When fusion is disabled (via `/fusion off`, the settings pane, or `--fusion-disabled`), every turn is skipped and no subprocesses are spawned. These skips keep the behavior predictable and avoid recursion.

## Context budget

Worker output inserted into the actor turn's system prompt is capped per worker (`fusion-output-bytes`, default `12000`). Recent conversation context sent to discovery/workers is separately capped (`fusion-context-bytes`, default `16000`). Discovery tool-result context is bounded internally before being shared downstream.

Full worker transcripts are not stored separately. The session stores only your original message; the planning bundle lives in the per-turn system prompt and is regenerated each fused turn, so it never accumulates across turns.

## Rough edges to watch

- Discovery/workers/rewrite are subprocesses, not true session forks. They receive a truncated text snapshot of recent conversation instead of the exact pi session tree.
- Discovery and planner workers do not see attached images. The actor prompt warns the actor when images are present.
- Worker subprocesses still load normal pi context files (`AGENTS.md`) but not extensions.
- Discovery, rewrite, and worker planning block the turn at `before_agent_start` until the fanout finishes, times out, or you cancel with `Esc`.
- The live split pane only appears in TUI mode; print/JSON/RPC still run fusion without that UI.
- There is intentionally no progress output in print/JSON/RPC modes. pi gives extensions no sanctioned stderr/diagnostic channel, and stdout is the consumed payload (final text in print mode, the event stream in JSON mode), so emitting progress there would corrupt it. The fanout runs silently in those modes.
- Some providers/models hide chain-of-thought, so a worker column may show no reasoning stream even when reasoning effort is enabled.
- Discovery/worker tool access is intentionally very narrow: no `bash`, no write/edit.
- Pipeline simplification (a discovery-bypass "lite" mode, merging the rewrite into discovery) is deliberately deferred; the current flow is two sequential LLM round-trips before the actor turn.
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
