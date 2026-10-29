# ai-agent-rules

AIエージェント（Claude Code・Codex 等）が参照する共通ルール。

> 📅 作成: 2026-09-02 / 更新: 2026-10-25

[^^](../)

### ルール

- [共通ルール](common-rules.md) 全プロジェクトで通るルールの実体。章ごとに `rules/` 配下へ参照が分かれている。
- [ローカルルール](notes/90_rules/local-rules.md) このプロジェクトでだけ通る決めごと。chat 待受けの運用と、共通ルールの追随。

### 資料

- [エージェントルール棚卸し](notes/01_research/r260828-01-エージェントルール棚卸し.md) 共通ルールの 63 項目を「共通 / 環境 / 固有」に分類し、配布先6エージェントのルールファイル規格を一次情報で調べたもの。
- [コンソールのコードページ問題の調査](notes/01_research/r260927-01-コンソールのコードページ問題.md) [p261027-01 振り返り](notes/01_research/p261027-01-振り返り.md) C# ・ PowerShell で出力エンコーディングを変えると同じ窓の cmd が化ける問題の実測と、外部情報の調査。
- [HTMLルールの切り出しと参照実験](notes/10_plan/p260923-01-HTMLルールの切り出しと参照実験.md) 「HTMLデザインルール」章を `rules/` へ切り出し、Claude Code・Codex が実体をその場所から参照できるかを試す計画。
- [ルール分割対象の分析](notes/10_plan/p260923-02-ルール分割対象の分析.md) `common-rules.md` と `rules/` の章ごとのサイズと固有語の分布を調べ、次に切り出す対象を決めるための分析。
- [Claudeフックの取り込み](notes/10_plan/p260927-01-Claudeフックの取り込み.md) フック本体を TypeScript で書き直し、`~/.claude/settings.json` からこのプロジェクトを直接参照する計画。Windows 専用の案は取り下げた。
- [共有リポジトリの同期](notes/10_plan/p261018-01-共有リポジトリの同期.md) Obsidian Vault と共通ルールの同期 (commit ・ pull ・ push) を、共有ツール `safe-push` 1 本に寄せる計画。
- [日本語のみ応答の書き直し](notes/10_plan/p261021-01-日本語のみ応答の書き直し.md) 英語だけの応答を、Stop フックで日本語に書き直させる計画。
- [SessionStart フックの統合](notes/10_plan/p261027-01-SessionStartフックの統合.md) SessionStart で動く 3 本のフックを入口 1 本にまとめ、出力を JSON 1 つにする計画。
- [REA 設定の通常セッションへの統合](notes/10_plan/p261027-02-REA設定の通常セッションへの統合.md) 専用コマンド `rea-claude` をやめ、REA の MCP ・ スキル ・ 会話ログを `~/.claude` にまとめる計画。

### 課題

- [課題](notes/40_issues/issues.md) これから解決することの記録。

[^^](../)
