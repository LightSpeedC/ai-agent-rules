# セキュリティルール

@rules/security-rules.md
<!-- 機密情報の扱い・パスの露出・アクセス範囲に関わる作業をするときは `rules/security-rules.md` を読み、その指示に従うこと。 -->

# プロジェクトフォルダ構成

@rules/project-layout-rules.md
<!-- 新規プロジェクトを作成するとき、またはファイルの置き場を決めるときは `rules/project-layout-rules.md` を読み、その指示に従うこと。 -->

# ワークフロールール

## 進め方の原則

@rules/workflow-principles-rules.md
<!-- 作業の進め方（修正の単位・実装順序・課題管理・範囲・案の出し方等）を決めるときは `rules/workflow-principles-rules.md` を読み、その指示に従うこと。 -->

## 確認と失敗

@rules/workflow-confirm-rules.md
<!-- コミット・ファイル削除・ルール反映等、取り消しにくい操作を行うときは `rules/workflow-confirm-rules.md` を読み、その指示に従うこと。 -->

## 共有環境の使い方

@rules/shared-env-rules.md
<!-- PlayWright・ai-chat-lite・Computer UseによるChrome操作・外部URLへのアクセス手段を使うときは `rules/shared-env-rules.md` を読み、その指示に従うこと。 -->

## git の使い方

@rules/git-rules.md
<!-- git のブランチ運用・コミット・タグ・リモートリポジトリ・.gitignore を扱うときは `rules/git-rules.md` を読み、その指示に従うこと。 -->

## 記録と運用

@rules/workflow-record-rules.md
<!-- セッション運用・cron・ルールの更新タイミング等を扱うときは `rules/workflow-record-rules.md` を読み、その指示に従うこと。 -->

## 言語表記

@rules/language-rules.md
<!-- 生成する文言・応答・日時表記・URLの書き方を決めるときは `rules/language-rules.md` を読み、その指示に従うこと。 -->

# コーディングルール

@rules/coding-rules.md
<!-- コード（ps1・cmd・js/ts 等）を作成・編集するときは `rules/coding-rules.md` を読み、その指示に従うこと。 -->

# SQLite の大原則

@rules/sqlite-rules.md
<!-- SQLite（node:sqlite・sqlite3 等）を扱うときは `rules/sqlite-rules.md` を読み、その指示に従うこと。 -->

# テストのルール

@rules/test-rules.md
<!-- テストを作成・編集するときは `rules/test-rules.md` を読み、その指示に従うこと。 -->

# シェル実行ルール

@rules/shell-rules.md
<!-- コマンドを実行するとき、ps1・cmd・bat 等のスクリプトを書くときは `rules/shell-rules.md` を読み、その指示に従うこと。 -->

# HTMLデザインルール

@rules/html-rules.md
<!-- HTML を作成・編集するときは `rules/html-rules.md` を読み、その指示に従うこと。 -->

# HTML でログを出力する

@rules/html-log-rules.md
<!-- ログを HTML で出力するときは `rules/html-log-rules.md` を読み、その指示に従うこと。 -->

# ドキュメントの作成日・更新日

@rules/doc-date-rules.md
<!-- ドキュメントを作成・更新するときは `rules/doc-date-rules.md` を読み、その指示に従うこと。 -->

# 学習資料の作成ルール

@rules/tutorial-rules.md
<!-- 勉強会資料・学習資料を作成・編集するときは `rules/tutorial-rules.md` を読み、その指示に従うこと。 -->

# HTML→Markdown 変換ルール

@rules/markdown-rules.md
<!-- HTML を Markdown に変換するとき、または Markdown を新規作成するときは `rules/markdown-rules.md` を読み、その指示に従うこと。 -->

# GitHub Pages 公開ルール

@rules/github-pages-rules.md
<!-- GitHub Pages を公開するときは `rules/github-pages-rules.md` を読み、その指示に従うこと。 -->

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
