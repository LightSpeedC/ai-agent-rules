# Claude フック

Claude Code のフック（SessionStart・Stop）を TypeScript で持つ。`~/.claude/settings.json` がこのフォルダのファイルを直接指すので、コピーは要らない。

> 📅 作成: 2026-10-03 / 更新: 2026-10-04

[README](../../../README.md)

## フック

### 1. 置き場と役割

| ファイル | 役割 | 呼び出し元イベント |
|---|---|---|
| `copy-session-jsonl.ts` | 会話ログ（JSONL）を、プロジェクト直下の `etc/history/jsonl/` へコピーする。コピー元は `transcript_path` と同じフォルダの全 `*.jsonl`。サイズと更新日時が同じものは飛ばす | SessionStart・Stop |
| `load-obsidian-memory.ts` | Obsidian Vault の `memory/!memory.md` を、`additionalContext` としてセッションに注入する | SessionStart |

標準モジュール（`node:fs`・`node:path`）だけで書いてある。`node` でも `bun run` でも同じファイルが動き、切り替え用のラッパーは持たない。

#### 結果の表示

フックの結果は、標準出力の JSON の `systemMessage` でユーザーに見せる（モデルへは渡らない）。SessionStart は結果を常に表示し、Stop は失敗したときだけ表示する（Stop は応答のたびに走るため）。失敗してもセッションは止めず、終了コードは常に 0。

表示の先頭には、絵文字に続けて、日付（月/日）と時刻（時:分、JST）が付く。いつの結果かが画面だけで分かる（例: `✅10/04 00:50 Obsidian メモリを注入した`）。下の表は、日時を除いた文言を示している。

| 場面 | 表示 |
|---|---|
| メモリの注入に成功 | ✅ Obsidian メモリを注入した |
| メモリを渡した（再開のみ。同じ内容が会話にあれば取り込まれない） | ✅ Obsidian メモリを渡した（再開では、会話にあれば取り込まれない） |
| 環境変数が未設定 | ⬜ Obsidian メモリ: 環境変数が未設定のため注入なし |
| `memory/!memory.md` が無い | ⬜ Obsidian メモリ: !memory.md が無いため注入なし |
| メモリの読み込みに失敗 | ❌ Obsidian メモリの読み込みに失敗した: <理由> |
| 会話ログのコピーに成功（SessionStart のみ） | ✅ 会話ログを N 件コピーした |
| コピーに失敗 | ❌ 会話ログのコピーに失敗した: <理由> |

失敗の理由に出るパスは、ホームを `~` に置き換える。

再開（`--continue` / `--resume`）では、`additionalContext` が会話にある分と同じだと、同じ回の `systemMessage` ごと捨てられる（Claude Code の重複排除。anthropics/claude-code の issue 96698）。そのため `copy-session-jsonl` は、SessionStart で、毎回違う開始時刻（`セッション開始: 2026/10/04 00:30:12.345 JST（source=resume）` の形）を `additionalContext` として一緒に渡し、同じ回に「新しい分」があるようにしている。Stop には付けない。

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
