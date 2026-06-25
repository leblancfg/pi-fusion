# pi-fusion へのコントリビュート

[English](CONTRIBUTING.md)

協力ありがとうございます。pi-fusion は小さな standalone pi extension なので、contribution loop は意図的に軽量にしています。

## セットアップ

```bash
pnpm install
```

Node 22+ が必要です (`.nvmrc` を参照)。package manager は pnpm です (`package.json` の `packageManager` で固定されています)。

## ローカルチェック

push 前に、CI が実行するすべてのチェックを 1 つのコマンドで実行してください。

```bash
pnpm run check
```

これは次の順で実行されます。

| Step   | Command                 | チェック内容                                         |
| ------ | ----------------------- | ---------------------------------------------------- |
| Format | `pnpm run format:check` | Prettier formatting (`.prettierrc.json`)             |
| Lint   | `pnpm run lint`         | ESLint + typescript-eslint                           |
| Types  | `pnpm run typecheck`    | `tsc --noEmit`                                       |
| Tests  | `pnpm test`             | `tests/` 内の unit tests                             |
| Smoke  | `pnpm run smoke`        | extension が flags/command/handlers を登録できること |

formatting の自動修正は `pnpm run format` で行います。

smoke test (`scripts/smoke.ts`) は、stub された `ExtensionAPI` に対して extension を読み込み、期待される flags、`/fusion` command、`session_start` / `input` / `before_agent_start` handlers が登録されることを検証します。API key は不要なので CI でも実行できます。

interactive な end-to-end check には、実際の `pi` に extension を読み込ませます。

```bash
pi -e ./extensions/pi-fusion/index.ts            # fusion enabled
pi -e ./extensions/pi-fusion/index.ts --fusion-disabled -p "say hi"   # gate only, no fanout
```

## Project layout

```text
extensions/pi-fusion/
  fusion.ts   # pure logic: settings, prompts, parsing, bypass (unit-tested)
  index.ts    # orchestration: subprocess fanout, lifecycle hooks, commands
  ui.ts       # TUI: settings pane and live worker panel
tests/        # node:test unit tests for fusion.ts
scripts/      # smoke.ts
```

pure で testable な logic は `fusion.ts` に置き、`tests/` でカバーしてください。`index.ts` と `ui.ts` は unit test しにくいため、`typecheck`、smoke test、manual TUI runs を重視します。

## Commits and PRs

- 1 commit には 1 つの論理的変更だけを含め、短くても内容がわかる message を付ける。
- test 可能な変更では先に test を書き、commit 前に `pnpm run check` が green であることを確認する。
- PR は focused に保ち、早めに小さく push する。
