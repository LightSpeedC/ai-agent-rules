---
schema: 1
id: i261025-02
title: Write で書いた ps1・html・cmd・bat を、convert-encoding で文字コードと改行に揃える
group: Claude フック（#1383 起票、2026-10-08）
created: 2026-10-25
---

依頼（#1672、20261019-file-manager から）。共通ルール「ツールごとの文字コードの扱い」は Write の後の変換を人に任せているが、守られず ps1 の日本語が化けた事例がある。Write の直後に、拡張子に応じた変換を掛ける PostToolUse フックを足してほしい。

**やること**

- [済] テストを先に書き（❌Red: 9 件）、実装して node・bun とも全件 102 件 ✅Green
- [済] `~/.claude/settings.json` と REA の `claude-config/settings.json` に PostToolUse（matcher: Write）を登録（バックアップは `tmp/`）。登録したコマンドそのままで試走し、BOM と CRLF が付くことを確かめた
- [済] 次の新しいセッションで、実環境から Write を行い、変換されることを確かめる（10/31 Write した html に BOM が付いた）
- [未] 報告元（20261019-file-manager）へ、対応の結果を返信し、検証を依頼する。OK が出るまで「済」にしない
