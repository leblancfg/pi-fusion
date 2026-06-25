{% raw %}

pi は、会話で起きたことを session ごとに記録します。pi-fusion は fused turn を再現、audit、resume できるように、その record へいくつか独自の entries を書き込みます。このページでは、何を書き込むか、何を意図的に **書き込まない** か、そしてそれらの entries を自分で読み取る・拡張する方法を正確に説明します。

pi session files は pi の session storage 配下にあります (例: `~/.pi/agent/sessions/<project>/<id>`)。各 session は append-only の entry list です。pi-fusion は過去の entries を rewrite したり delete したりしません。append だけを行います。同じ kind の entry では最新のものが有効になります。

## pi-fusion が書き込むもの

armed された 1 回の fused turn は、3 種類の entries を生成します。

| Kind                  | Entry shape                                  | LLM に渡されるか?       | 目的                                                               |
| --------------------- | -------------------------------------------- | ----------------------- | ------------------------------------------------------------------ |
| `pi-fusion-settings`  | `custom` entry                               | No                      | 現在の settings snapshot。次の session で復元するため。           |
| `pi-fusion-run`       | `custom_message` (visible)                   | Yes — bounded handoff   | thread に表示される、compact で model-visible な run record。      |
| `pi-fusion-archive`   | `custom` entries (1 manifest + N chunks)     | No                      | audit と resume 用の、完全で未切り詰めの sub-agent transcript。    |

### session に含まれないもの

- **synthesis prompt / planning bundle。** これはその turn の **system prompt** にだけ注入されます (`before_agent_start` 経由)。fused turn ごとに再生成され、entry として保存されません。turn をまたいで蓄積しません。
- **元の message は変更されません。** pi-fusion はあなたが入力した prompt を rewrite しません。`/tree` と `/fork` は元の text を表示し続けます。
- **完全な sub-agent output は context に入りません。** model-visible なのは bounded な `pi-fusion-run` handoff だけです。完全な transcript は archive entries にあり、pi の context builder はそれを model に渡しません。

## 1. Settings entry — `pi-fusion-settings`

settings が変更されたときに書き込まれます (`/fusion` pane、slash command、turn の arming、session compaction)。これは `custom` entry です。

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

次の `session_start` で、pi-fusion は **最新の** `pi-fusion-settings` entry を読み込み、startup flags の下に merge します。古い entries は無視されるため、file はすべての settings change の履歴を自然に保持しますが、その履歴が挙動に影響することはありません。legacy keys (`model`, `synthesizerModel`, `synthesizerThinking`) は古い sessions のために引き続き読み取られ、migrate されます。

## 2. Run handoff — `pi-fusion-run`

各 fused turn ごとに visible custom message が append されます。`content` は resume 後や後続ターンが実際に見る内容です。`details` payload は TUI の expandable transcript preview を動かします。

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

`content` (model-visible handoff) は `resumeContextBytes` (default 8000) で上限が設定されます。`details` previews は別に上限があり、重い fields は意図的に落とします。worker reasoning と tool context は in-context preview から省かれますが、archive には完全に残ります。`runId`、`archiveChunks`、`archiveBytes` はこの message と archive を結びます。

## 3. Archive — `pi-fusion-archive`

durable で full-fidelity な record です。`custom` entries として保存されるため、pi の context builder は model に渡しません。そのため、discovery、rewrite、worker sub-agents が生成したすべてのもの、つまり prompts、reasoning、output、tool context、stderr、usage を context を増やさずに保持できます。

transcript は 1 つの markdown document として render され、その後 byte-exact chunks に分割されます。これにより個々の session lines は適度な長さに保たれます。保存形式は **1 manifest entry の後に N chunk entries** です。

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

主な保証:

- **Schema tag。** すべての archive entry は `"schema": "pi-fusion.archive.v1"` を持ちます。parse 前に確認してください。layout が変わる場合は version が上がります。
- **Chunking は lossless。** Chunks は UTF-8 boundary 上で 48 KB ごとに分割されます。すべての chunk の `content` を `index` 順に連結すると transcript が byte-for-byte で復元されます。chunking は semantic truncation ではありません。
- **Run ids は sort 可能。** Format は `fusion-YYYYMMDD-HHMMSS-<rand>` (例: `fusion-20260617-153012-a1b2c3`) なので、lexical order が chronological order になります。

## run を読む

組み込み command がもっとも簡単です。

```text
/fusion-transcript                     # 最新 run を開く。複数ある場合は list
/fusion-transcript list                # この session の archived runs を一覧表示
/fusion-transcript <runId>             # 特定 run を editor で開く
/fusion-transcript <runId> --write out.md   # full transcript を file に export
```

session entries から自分で run を再構築するには:

1. `type == "custom"` かつ `customType == "pi-fusion-archive"` の entries をすべて集める。
2. `data.schema == "pi-fusion.archive.v1"` のものだけを残す。
3. 対象 `runId` の manifest (`data.kind == "manifest"`) を選ぶ。latest run の場合は最後の manifest を選ぶ。
4. その run の chunks (`data.kind == "chunk"`) を `data.index` で sort し、`data.content` を join する。

extension は、これと同じことを行う helpers を export しています。自分の tooling でも再利用できます。

- `reconstructFusionArchive(entries, runId?)` → run の `{ manifest, content }` (`runId` 省略時は latest)。
- `listFusionArchiveRuns(entries)` → session 内のすべての manifests。
- `buildFusionArchiveEntries(input)` → pi-fusion が保存する `{ manifest, chunks }` pair。
- `chunkUtf8(text, maxBytes)` / `createFusionRunId()` → chunking と run-id の primitives。

## session footprint を決める settings

| Setting              | Slash command            | Flag                     | session への影響                                                            |
| -------------------- | ------------------------ | ------------------------ | --------------------------------------------------------------------------- |
| `resumeContextBytes` | `/fusion resume N`       | `--fusion-resume-bytes`  | model-visible な `pi-fusion-run` handoff の size cap (default 8000)。       |
| `contextBytes`       | `/fusion context N`      | `--fusion-context-bytes` | discovery/workers **へ送られる** recent conversation (保存はされない)。     |
| `workerOutputBytes`  | `/fusion output N`       | `--fusion-output-bytes`  | synthesis system prompt に splice される worker output (保存はされない)。   |

archive chunk size (48 KB) は固定定数で、user-configurable ではありません。archive 自体は budgets に関係なく常に完全に書き込まれます。budgets が制限するのは model に届く内容だけで、記録される内容ではありません。

## 拡張する

これらの entries の上に custom transcript viewer、eval harness、external audit log などを作る場合は、位置に関する仮定ではなく、`customType` と `schema` tags に依存してください。append-only semantics により、自分の `customType` を使う限り、pi-fusion の entries と衝突せずに独自の `custom` entries を追加できます。`pi-fusion.archive.v1` は major version 内の stable contract として扱ってください。変更がある場合、schema string も一緒に変わります。

{% endraw %}
