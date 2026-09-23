# Obsidianメモリ連携ルール

Obsidian VaultをAIの永続メモリとして使う。
Obsidian MCPから `memory/!memory.md` を読む（起動時に SessionStart フックが自動注入する）。

## ロード（起動時）

- SessionStartフックが `memory/!memory.md`（メモリ目次）を自動注入する。
- 作業に関連するメモリノートは obsidian-mcp MCP または Read で本文を読む。

## 保存（作業完了時）

- 再利用価値のある新事実（ユーザの好み・作業方針・進行中の作業・参照先）が判明したら、`memory/` 配下にメモリノート（1ノート＝1事実）を作成する。
- フロントマターに type（`user` / `feedback` / `project` / `reference`）を付け、必ず `[[!memory]]` をリンクする。
- `memory/!memory.md` の「メモリ一覧」へ1行ポインタ（`- [[ノート名]] — 要約（type）`）を追記する。
- 既存メモリと重複する場合は新規作成せず既存ノートを更新する。誤りが判明したメモリは削除する。
