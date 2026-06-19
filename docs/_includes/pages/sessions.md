{% raw %}

pi keeps a per-session record of everything that happens in a conversation. pi-fusion writes a few
of its own entries into that record so a fused turn is reproducible, auditable, and resumable. This
page documents exactly what it writes, what it deliberately does **not** write, and how to read or
extend those entries yourself.

pi session files live under pi's session storage (e.g. `~/.pi/agent/sessions/<project>/<id>`). Each
session is an append-only list of entries. pi-fusion never rewrites or deletes prior entries; it only
appends. The newest entry of a given kind wins.

## What pi-fusion writes

A single armed, fused turn produces three kinds of entries:

| Kind                  | Entry shape                                  | Fed to the LLM?            | Purpose                                                            |
| --------------------- | -------------------------------------------- | -------------------------- | ----------------------------------------------------------------- |
| `pi-fusion-settings`  | `custom` entry                               | No                         | The current settings snapshot, so the next session restores them. |
| `pi-fusion-run`       | `custom_message` (visible)                   | Yes — the bounded handoff  | The compact, model-visible record of the run shown in the thread. |
| `pi-fusion-archive`   | `custom` entries (1 manifest + N chunks)     | No                         | The full, untruncated sub-agent transcript, for audit and resume. |

### What is NOT in the session

- **The synthesis prompt / planning bundle.** It is injected into that turn's **system prompt** only
  (via `before_agent_start`), regenerated each fused turn, and never stored as an entry. It does not
  accumulate across turns.
- **Your original message is untouched.** pi-fusion does not rewrite the prompt you typed. `/tree`
  and `/fork` still show your original text.
- **Full sub-agent output is kept out of context.** Only the bounded `pi-fusion-run` handoff is
  model-visible. The complete transcript lives in the archive entries, which pi's context builder
  never feeds to the model.

## 1. Settings entry — `pi-fusion-settings`

Written whenever settings change (the `/fusion` pane, a slash command, arming a turn, or session
compaction). It is a `custom` entry:

```json
{
  "type": "custom",
  "customType": "pi-fusion-settings",
  "data": {
    "enabled": false,
    "discoveryEnabled": true,
    "rewriteEnabled": true,
    "workerCount": 3,
    "workers": [{ "model": null, "thinking": null }],
    "workerOutputBytes": 12000,
    "contextBytes": 16000,
    "resumeContextBytes": 8000,
    "timeoutMs": 600000,
    "discoveryModel": null,
    "workerModel": null,
    "synthesisModel": null,
    "discoveryThinking": null,
    "workerThinking": null,
    "synthesisThinking": null,
    "plannerToolMode": "all",
    "preset": null
  }
}
```

On the next `session_start`, pi-fusion reads the **most recent** `pi-fusion-settings` entry and merges
it under any startup flags. Older entries are ignored, so the file naturally holds a history of every
settings change without that history affecting behavior. Legacy keys (`model`, `synthesizerModel`,
`synthesizerThinking`) are still read and migrated for older sessions.

## 2. Run handoff — `pi-fusion-run`

A visible custom message appended for each fused turn. Its `content` is what resumed and subsequent
turns actually see; its `details` payload drives the expandable transcript preview in the TUI.

```json
{
  "customType": "pi-fusion-run",
  "display": true,
  "content": "∪ pi-fusion transcript: discovery completed; rewrite completed; 3/3 workers completed.\n\nParallel sub-agents produced this answer. Their full transcripts are archived in this pi session (run fusion-20260617-153012-a1b2c3) and are intentionally kept out of context. Run `/fusion-transcript fusion-20260617-153012-a1b2c3` to inspect them.\n\n...",
  "details": {
    "task": "…(≤ 2 KB preview)…",
    "discoveryEnabled": true,
    "rewriteEnabled": true,
    "promptVariations": ["…", "…", "…"],
    "discovery": { "label": "discovery", "status": "completed", "output": "…", "usage": { } },
    "rewrite": { "label": "rewrite", "status": "completed", "output": "…", "usage": { } },
    "workers": [{ "label": "worker 1: #1", "status": "completed", "output": "…", "usage": { } }],
    "runId": "fusion-20260617-153012-a1b2c3",
    "archiveChunks": 2,
    "archiveBytes": 81234
  }
}
```

`content` (the model-visible handoff) is bounded by `resumeContextBytes` (default 8000). The `details`
previews are bounded separately and intentionally drop the heaviest fields (worker reasoning and tool
context are omitted from the in-context preview; the archive keeps them in full). `runId`,
`archiveChunks`, and `archiveBytes` link this message to its archive.

## 3. Archive — `pi-fusion-archive`

The durable, full-fidelity record. Because it is stored as `custom` entries, pi's context builder
never feeds it to the model, so it can hold everything the discovery, rewrite, and worker sub-agents
produced — prompts, reasoning, output, tool context, stderr, and usage — without inflating context.

The transcript is rendered as one markdown document, then split into byte-exact chunks (so individual
session lines stay reasonable). It is persisted as **one manifest entry followed by N chunk entries**:

```json
{
  "type": "custom",
  "customType": "pi-fusion-archive",
  "data": {
    "schema": "pi-fusion.archive.v1",
    "kind": "manifest",
    "runId": "fusion-20260617-153012-a1b2c3",
    "createdAt": "2026-06-17T15:30:12.000Z",
    "task": "Add a docs page about the session file",
    "discoveryEnabled": true,
    "rewriteEnabled": true,
    "workerCount": 3,
    "completedWorkers": 3,
    "chunks": 2,
    "bytes": 81234
  }
}
```

```json
{
  "type": "custom",
  "customType": "pi-fusion-archive",
  "data": {
    "schema": "pi-fusion.archive.v1",
    "kind": "chunk",
    "runId": "fusion-20260617-153012-a1b2c3",
    "index": 0,
    "total": 2,
    "content": "# pi-fusion run fusion-20260617-153012-a1b2c3\n…"
  }
}
```

Key guarantees:

- **Schema tag.** Every archive entry carries `"schema": "pi-fusion.archive.v1"`. Check it before
  parsing; the version will bump if the layout changes.
- **Chunking is lossless.** Chunks are split on UTF-8 boundaries at 48 KB each. Concatenating every
  chunk's `content` in `index` order reproduces the transcript byte-for-byte — chunking is never a
  semantic truncation.
- **Run ids are sortable.** Format `fusion-YYYYMMDD-HHMMSS-<rand>` (e.g.
  `fusion-20260617-153012-a1b2c3`), so lexical order is chronological.

## Reading a run

The built-in command is the easiest path:

```text
/fusion-transcript                     # open the latest run (or list, if several)
/fusion-transcript list                # list archived runs in this session
/fusion-transcript <runId>             # open a specific run in the editor
/fusion-transcript <runId> --write out.md   # export the full transcript to a file
```

To reconstruct a run yourself from the session entries:

1. Collect every entry with `type == "custom"` and `customType == "pi-fusion-archive"`.
2. Keep only those whose `data.schema == "pi-fusion.archive.v1"`.
3. Pick the manifest (`data.kind == "manifest"`) for your `runId`, or the last manifest for the
   latest run.
4. Take that run's chunks (`data.kind == "chunk"`), sort by `data.index`, and join their `data.content`.

The extension exports helpers that do exactly this, reusable in your own tooling:

- `reconstructFusionArchive(entries, runId?)` → `{ manifest, content }` for a run (latest if `runId`
  is omitted).
- `listFusionArchiveRuns(entries)` → all manifests in the session.
- `buildFusionArchiveEntries(input)` → the `{ manifest, chunks }` pair pi-fusion persists.
- `chunkUtf8(text, maxBytes)` / `createFusionRunId()` → the chunking and run-id primitives.

## Settings that shape the session footprint

| Setting              | Slash command            | Flag                     | Effect on the session                                                       |
| -------------------- | ------------------------ | ------------------------ | --------------------------------------------------------------------------- |
| `resumeContextBytes` | `/fusion resume N`       | `--fusion-resume-bytes`  | Size cap of the model-visible `pi-fusion-run` handoff (default 8000).       |
| `contextBytes`       | `/fusion context N`      | `--fusion-context-bytes` | Recent conversation sent **into** discovery/workers (not stored).           |
| `workerOutputBytes`  | `/fusion output N`       | `--fusion-output-bytes`  | Worker output spliced into the synthesis system prompt (not stored).        |

The archive chunk size (48 KB) is a fixed constant and is not user-configurable. The archive itself
is always written in full regardless of these budgets — the budgets only bound what reaches the model,
never what is recorded.

## Extending it

If you want to build on these entries — a custom transcript viewer, an eval harness, an external
audit log — rely on the `customType` and `schema` tags, not on positional assumptions. Append-only
semantics mean you can safely add your own `custom` entries alongside pi-fusion's without collision,
as long as you use your own `customType`. Treat `pi-fusion.archive.v1` as a stable contract within a
major version; if it changes, the schema string changes with it.

{% endraw %}
