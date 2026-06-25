{% raw %}

Presets は `/fusion` settings pane の名前付き snapshot です。model access、budget、task shape に合う設定を保存するためのもので、古くなりやすい hard-coded defaults に依存しないで済みます。

preset には次を保存できます。

- 次の対象ターンで fusion を armed するかどうか。
- discovery と rewrite の toggles。
- worker count。
- default worker model と reasoning effort。
- worker ごとの model / reasoning overrides。
- discovery model と reasoning effort。
- synthesis model と reasoning effort。
- output、context、timeout budgets。

## Presets の保存場所

pi-fusion は 2 つの JSON files を読み込みます。

| Scope   | Path                      | 用途                                                   |
| ------- | ------------------------- | ------------------------------------------------------ |
| Global  | `~/.pi/agent/fusion.json` | すべての repo で使いたい personal presets。            |
| Project | `.pi/fusion.json`         | project と一緒に保持したい repo-specific presets。     |

project presets は同名の global presets を上書きします。pi-fusion は current working directory から上方向へ既存の `.pi/fusion.json` または `.git` directory を探すため、subdirectory から pi を起動しても repo-level config が見つかります。これは pi 自身の preset-extension pattern と同じ考え方です。global defaults が先、project-specific settings が後です。

pi-fusion は `~/.pi/agent/settings.json` には書き込みません。この file は pi の main settings と package list 用です。extension-specific data は別の `fusion.json` に分けることで、削除や共有がしやすくなります。

## TUI から preset を作成する

settings pane を開きます。

```text
/fusion
```

**Presets** へ移動して Enter を押します。そこから次の操作ができます。

- 現在の settings を global preset として保存する。
- 現在の settings を project preset として保存する。
- 保存済み preset を読み込む。
- 保存済み preset を削除する。

pane から保存すると、pane に現在表示されている内容がそのまま書き込まれます。workers を `4` にし、worker model に `google-vertex/gemini-3.5-flash` を選び、synthesis model に `anthropic/claude-sonnet-4-5` を設定していれば、その内容が preset に保存されます。隠れた追加挙動はありません。

## Slash commands で preset を作成・読み込みする

```text
/fusion preset list
/fusion preset save cheap-planners
/fusion preset save-project repo-review
/fusion preset cheap-planners
```

Command behavior:

| Command                            | Effect                                                        |
| ---------------------------------- | ------------------------------------------------------------- |
| `/fusion preset list`              | 保存済み presets と scope を一覧表示します。                  |
| `/fusion preset save NAME`         | 現在の settings を `~/.pi/agent/fusion.json` に保存します。   |
| `/fusion preset save-project NAME` | 現在の settings を `.pi/fusion.json` に保存します。           |
| `/fusion preset NAME`              | project presets を先に、次に global presets から `NAME` を読み込みます。 |

## 起動時に preset を読み込む

```bash
pi --fusion-preset cheap-planners --fusion-enabled
```

`--fusion-preset` は `session_start` 中に名前付き settings snapshot を読み込みます。存在しない preset を作ることはありません。名前が間違っている場合、pi-fusion は TUI notification area に既知の preset names を表示します。

## JSON format

file は意図的に plain JSON です。

```json
{
  "version": 1,
  "presets": {
    "cheap-planners": {
      "description": "Gemini Flash workers feeding the current synthesis model",
      "settings": {
        "enabled": true,
        "discoveryEnabled": true,
        "rewriteEnabled": true,
        "workerCount": 3,
        "workerModel": "google-vertex/gemini-3.5-flash",
        "workerThinking": "off",
        "plannerToolMode": "all",
        "synthesisModel": null,
        "synthesisThinking": "current",
        "workerOutputBytes": 12000,
        "contextBytes": 16000,
        "timeoutMs": 600000,
        "workers": []
      }
    }
  }
}
```

Notes:

- `enabled: true` は preset が読み込まれたとき、fusion を 1 つの対象ターンだけ armed します。fused turn が始まると、pi-fusion は state を off に戻して書き込みます。
- missing fields は pi-fusion defaults を継承します。
- active pi session model を使うには、model field に `null`、`"current"` を設定するか、省略します。
- 有効な reasoning values は `off`、`minimal`、`low`、`medium`、`high`、`xhigh` です。current session setting を使うには reasoning field を省略します。
- `plannerToolMode` は discovery と worker の tool access を制御します。通常の tool access には `all`、元の `read`/`grep`/`find`/`ls` のみの mode には `read-only` を使います。missing fields は `all` に backfill されます。
- `workers` は optional です。存在する場合、各 entry は特定 worker slot の default worker model や reasoning を上書きできます。

## 例: 安価な planners と premium synthesis

多くの人が最初に試すと想定している構成です。

```json
{
  "version": 1,
  "presets": {
    "cheap-planners": {
      "description": "Fast worker fanout, current model as synthesis",
      "settings": {
        "enabled": true,
        "discoveryEnabled": true,
        "rewriteEnabled": true,
        "workerCount": 3,
        "discoveryModel": "google-vertex/gemini-3.5-flash",
        "discoveryThinking": "off",
        "workerModel": "google-vertex/gemini-3.5-flash",
        "workerThinking": "off",
        "plannerToolMode": "all",
        "synthesisModel": null,
        "synthesisThinking": null,
        "workerOutputBytes": 12000,
        "contextBytes": 16000,
        "timeoutMs": 600000
      }
    }
  }
}
```

高価な model を synthesis seat に置き、安価な planners で blind spots を減らす構成です。常に良いわけではありません。自分の workload で parallel planning の価値が cost を上回るか試すための、よい starting point です。

## 例: 4 人の specialist workers

```json
{
  "version": 1,
  "presets": {
    "review-panel": {
      "description": "Mixed worker panel for code review",
      "settings": {
        "enabled": true,
        "workerCount": 4,
        "workerModel": "google-vertex/gemini-3.5-flash",
        "workerThinking": "off",
        "workers": [
          { "model": "google-vertex/gemini-3.5-flash", "thinking": "off" },
          { "model": "anthropic/claude-haiku-4-5", "thinking": "low" },
          { "model": null, "thinking": "medium" },
          { "model": "openai/gpt-5.2-codex", "thinking": "low" }
        ]
      }
    }
  }
}
```

各 worker slot は明示的な override がない限り、`workerModel` と `workerThinking` を継承します。

## トラブルシューティング

### preset が表示されない

JSON file に top-level の `presets` object があり、JSON syntax が正しいことを確認してください。不正な `fusion.json` は extension を crash させずに無視されます。Project presets は `.pi/fusion.json` に置きます。pi-fusion は pi が実行されている directory から上方向へ探索します。

### preset を保存したが、読み込んでも model が変わらない

model spec は pi が見つけられる `provider/model` 形式である必要があります。TUI model picker から current session model に戻すことも、JSON で `null` を使うか省略することもできます。

### preset を repo で共有したい

`/fusion preset save-project NAME` を使ってください。team で共有する場合は `.pi/fusion.json` を commit します。personal な API cost の選択は `~/.pi/agent/fusion.json` に置いてください。

### すべての fusion presets を削除したい

`~/.pi/agent/fusion.json` と project の `.pi/fusion.json` files を削除してください。extension は、再度 preset を保存したときだけ files を作り直します。

---

## Prompt Customization

`pi-fusion` が使うすべての prompts は完全にカスタマイズできます。初回実行時に、default prompts が global `fusion.json` file に自動的に書き込まれます。そこで確認・編集でき、project ごとに上書きすることもできます。

### プロンプトの保存場所

`pi-fusion` は 2 つの場所から prompts を読み込みます。

| Scope   | Path                      | 用途                                                |
| ------- | ------------------------- | --------------------------------------------------- |
| Global  | `~/.pi/agent/fusion.json` | すべての project で使う default templates。         |
| Project | `.pi/fusion.json`         | team で共有する project-specific templates。        |

Project-level prompts は field ごとに global prompts を上書きします。pi-fusion は current working directory から上方向へ既存の `.pi/fusion.json` または `.git` directory を探すため、subdirectory から pi を起動しても repo-level config が見つかります。たとえば project file で `worker` だけを上書きし、global の `discovery`、`rewrite`、`actor` templates はそのまま使えます。

### JSON format

`fusion.json` の top level に `"prompts"` section を追加します。

```json
{
  "version": 1,
  "prompts": {
    "discovery": "...",
    "rewrite": "...",
    "worker": "...",
    "synthesis": "..."
  },
  "presets": {
    "cheap-planners": {
      "description": "Fast worker fanout, current model as synthesis",
      "settings": {
        ...
      }
    }
  }
}
```

### 利用可能な Prompts と Placeholders

各 prompt は単純な `{{placeholder}}` templating に対応しています。置換したい template tags を保持していれば、instruction text は並べ替え、書き換え、全面的な再フォーマットが可能です。

#### 1. Discovery Prompt (`prompts.discovery`)

この prompt は、discovery agent が codebase を探索するための指示です。

- **Placeholders:**
  - `{{cwd}}`: project の working directory。
  - `{{task}}`: 元の prompt。
  - `{{recentContext}}`: 整形済みの直近会話履歴。
  - `{{toolGuidance}}`: 選択された planner tool mode 用の整形済み guidance。

#### 2. Prompt Rewrite (`prompts.rewrite`)

この prompt は、rewrite model に worker prompts を生成させるために使われます。

- **Placeholders:**
  - `{{workerCount}}`: parallel workers の数。
  - `{{task}}`: 元の prompt。
  - `{{recentContext}}`: 整形済みの直近会話履歴。

#### 3. Worker Prompt (`prompts.worker`)

この prompt は各 parallel worker で実行されます。

- **Placeholders:**
  - `{{cwd}}`: project の working directory。
  - `{{task}}`: 元の prompt。
  - `{{assignedPrompt}}`: この worker 用に生成された rewritten prompt variation。
  - `{{discoveryContext}}`: discovery agent が読み込み、handoff した context。
  - `{{workerName}}`: slot index/name (例: `#1`, `#2`)。
  - `{{discoveryGuidance}}`: discovery context の使い方に関する整形済み guidance。
  - `{{toolGuidance}}`: 選択された planner tool mode 用の整形済み guidance。
  - `{{recentContext}}`: 整形済みの直近会話履歴。

#### 4. Synthesis Prompt (`prompts.synthesis`)

この prompt は、synthesis turn に注入される最終 planning bundle を整形します。

- **Placeholders:**
  - `{{task}}`: 元の prompt。
  - `{{discoveryContext}}`: discovery agent が読み込んだ context。
  - `{{variations}}`: worker prompt variations の一覧。
  - `{{workerOutputs}}`: 各 worker が生成した outputs と plans。
  - `{{imageNote}}`: 添付画像がある場合に、workers が画像を見ていないことを synthesis step へ伝える note。

> 💡 **Important:** synthesis prompt template には `<!-- pi-fusion:synthesis-prompt -->` を含めてください。これにより、後続の会話ターンは fused turn が完了したことを認識し、fusion を自動的に bypass できます。custom synthesis prompt がこれを省略した場合、pi-fusion は defensive に marker を先頭へ追加します。
{% endraw %}
