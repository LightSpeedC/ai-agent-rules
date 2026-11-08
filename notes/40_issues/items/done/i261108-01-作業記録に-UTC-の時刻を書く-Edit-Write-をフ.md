---
schema: 1
id: i261108-01
title: 作業記録に UTC の時刻を書く Edit ・ Write をフックで止める
group: 他プロジェクトからのルール変更依頼（2026-11-07 起票）
created: 2026-11-08
---

11/08 に 20260917-oracle-cloud から依頼を受けた (セッション間のメッセージ)。作業記録 (`_config/` の HTML) に UTC の時刻を JST に直さずに書いた事故があり、ルールの更新 (#1823) だけでは止まらなかった。案: Edit ・ Write でパスが `_config/` 配下の `.html` のとき、新しい内容に UTC の時刻表記があり同じ行に JST が無ければ止め、「作業記録の時刻は JST で書く。UTC の出力は JST に換算してから書く」と返す。同じ行に JST を添えてあれば通す。置き場 (ホームの settings.json かプロジェクトの .claude か)、誤検知の扱い、実環境での確かめ方はこちらで決める。

**やること**

- [済] 利用者の了承を得て、置き場と止める条件の案を出す (置き場は 3-A: 本体を `tools/80_ops/claude-hooks/guard-utc-in-record.ts` に置き、ホームの settings.json の PreToolUse に matcher `Edit|Write` で登録。条件は 2-A: `UTC` の語だけを見る。11/08)
- [済] テストを先に書いて実装し、settings.json のコマンドそのままで試走する (`tests/guard-utc-in-record.test.ts` で ❌Red 4 件を見てから実装し、node ・ bun とも 186 件 ✅Green。登録したコマンドで、JST の無い行は deny、JST を添えた行は通ることを確かめた。11/08)
- [済] 依頼元へ返信し、実際の書き込みで止まることの確認を受ける (11/08 に SendMessage で返信した。依頼元が実環境で _config/ の .html に Write し、「01:41 UTC」だけの行は deny、「01:41 UTC (JST 10:41)」の行は通ることを確かめ、OK を受けた)
