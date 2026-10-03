# Claude フック

Claude Code のフック（SessionStart・Stop）を TypeScript で持つ。`~/.claude/settings.json` がこのフォルダのファイルを直接指すので、コピーは要らない。

> 📅 作成: 2026-10-03 / 更新: 2026-10-03

[README](../../../README.md)

## フック

### 1. 置き場と役割

| ファイル | 役割 | 呼び出し元イベント |
|---|---|---|
| `copy-session-jsonl.ts` | 会話ログ（JSONL）を、プロジェクト直下の `etc/history/jsonl/` へコピーする。コピー元は `transcript_path` と同じフォルダの全 `*.jsonl`。サイズと更新日時が同じものは飛ばす | SessionStart・Stop |
| `load-obsidian-memory.ts` | Obsidian Vault の `memory/!memory.md` を、`additionalContext` としてセッションに注入する | SessionStart |

標準モジュール（`node:fs`・`node:path`）だけで書いてある。`node` でも `bun run` でも同じファイルが動き、切り替え用のラッパーは持たない。

### 2. 設定

#### 環境変数

`load-obsidian-memory.ts` は、Vault の場所を環境変数 `AI_AGENT_OBSIDIAN_VAULT` から読む。未設定、または `memory/!memory.md` が無いときは、何も注入せずに正常終了する。

#### settings.json の書き方

`~/.claude/settings.json` の `hooks` から、このフォルダのファイルを直接呼ぶ。パスはその環境でのこのリポジトリの置き場にする。

```json
"command": "node \"W:/ai-agent-rules/tools/80_ops/claude-hooks/copy-session-jsonl.ts\""
```

Node は、`.ts` を直接実行できる版（v22.18.0 以降、または v23.6.0 以降）が要る。手元の v26.10.0 では実測で動いた。

### 3. テスト

テストは `tests/claude-hooks.test.ts`。本番の `~/.claude` や Vault には触れず、`tmp/` の下だけで動く。`tools/40_test/run-tests.cmd` が、node と bun の両方で全件を実行する。

[README](../../../README.md)
