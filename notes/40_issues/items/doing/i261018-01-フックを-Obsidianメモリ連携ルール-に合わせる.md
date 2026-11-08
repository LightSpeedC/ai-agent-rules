---
schema: 1
id: i261018-01
title: フックを「Obsidianメモリ連携ルール」に合わせる
group: Claude フック（#1383 起票、2026-10-08）
created: 2026-10-18
---

依頼（#1548、ai-obsidian-vault から。Vault の計画 p261017-01）: Claude フックを、共通ルール「Obsidianメモリ連携ルール」に合わせる。ルールに無い決め事は次のとおり。

- 同期は `safe-push <Vault> --all`。SessionStart で同期に失敗しても、注入は続ける
- SessionStart で `projects/!projects.md` も注入する。注入文から MCP の記述を消す
- 未登録の判定に使うプロジェクト名は `CLAUDE_PROJECT_DIR` のフォルダ名、無ければ `cwd`。Vault 自体も特別扱いしない
- daily の追記を促すのは、最後の追記から 6 時間以上空いたとき

今の `load-obsidian-memory.ts` は、注入文で「obsidian-mcp MCP または Read で読む」と案内しており、ルールの「MCP は使わない」と食い違っている。

**やること**

- [済] 計画（`notes/10_plan/i261018-01-フックをObsidian連携ルールに合わせる.html`）を立て、利用者の承認を得る（10/20、決めることは 3 点とも A）
- [済] テストを先に書き（❌Red: 13 件）、実装して node・bun とも 52 件 ✅Green
- [済] `settings.json` の hooks を書き換え（Stop に `sync-obsidian-vault.ts`、SessionStart の timeout 30 秒）、コマンドそのままで試走
- [済] 実環境のフック（SessionStart・Stop）から動かして結果を見る。SessionStart は 10/25 の compact 後に、MCP の記述が無い Vault 注入が出た。Stop は Vault の履歴に safe-push の commit が turn ごとに残った（10/25 12:22・13:04）
- [未] 報告元（ai-obsidian-vault）の確認
