# 失敗したままの Edit・Write の後の git commit を止める

対象: ai-agent-rules ／ 入力: 20261019-file-manager のサンプル `guard-commit-after-failed-edit.ts` (#1727) と、会話の記録 (JSONL) ／ 出力: `tools/80_ops/claude-hooks/guard-commit-after-failed-edit.ts` ・ そのテスト ・ `~/.claude/settings.json` の PreToolUse の登録 ・ フックの README

> 📅 作成: 2026-11-01 / 更新: 2026-11-01

[トップへ戻る](../../README.md)

## 目次

1. [目的](#1-目的)
2. [現状](#2-現状)
3. [設計](#3-設計)
4. [手順](#4-手順)
5. [決めることの一覧](#5-決めることの一覧)

## 1. 目的

Edit の失敗を見ないまま git commit し、壊れたファイルが入った (20261019-file-manager の振り返り 413-A)。文だけのルールでは止まらなかったので、commit の前にフックで止める。

## 2. 現状

- 依頼元がサンプルを用意した。動かして確かめてはいない。未確認として挙がっていたのは、Edit の失敗で `tool_result` の `is_error` が true になるか
- 11/01 にこのプロジェクトの会話の記録で確かめた。`String to replace not found in file.` と `File has not been read yet.` のどちらも `"is_error":true` だった
- 既存の PreToolUse のフックは `guard-bash-sed-awk.ts` と `guard-english-before-tool.ts`。どちらも `deny` で止める

## 3. 設計

- サンプルを元に、単独のファイル `guard-commit-after-failed-edit.ts` として置く (決めることの 5)
- 対象は Bash ・ PowerShell のツールで、区切り (`&&` ・ `||` ・ `;` ・ `|` ・ 改行) ごとに、先頭が `git` で、続けて `commit` があるもの (`git -c x=y commit` ・ `git -C <path> commit` も含む)
- 会話の記録を頭から読み、ファイルごとに「最後の Edit ・ Write が失敗したか」を持つ。**失敗の後に同じファイルへの Edit ・ Write が通るか、Read が通れば解く** (決めることの 3)
- 通った commit の後の失敗だけを見る。それより前の失敗は解く
- 残っていれば `deny` で止め、理由に、ファイル名と解き方 (Read で確かめるか、Edit を通す) を書く (決めることの 4)
- ファイル名は大小と区切り (`\` と `/`) を揃えて比べる (Windows は大小を区別しない)
- 記録が読めない ・ 壊れた行があるときは止めない (フックの不具合で commit を止め続けない)

## 4. 手順

| # | 作業 | 状態 |
|---:|---|---|
| 1 | この計画の承認 (決めることは 11/01 に 3-A ・ 4-A ・ 5-A)。11/01 承認 | ✅ **済** |
| 2 | テストを先に書き、❌Red を見る。失敗したままなら止める ・ 後の Edit で解ける ・ 後の Read で解ける ・ 通った commit より前の失敗は見ない ・ commit でないコマンドは通す ・ `git -C` も止める ・ 大小と区切りの違うパスを同じとみなす ・ 記録が無いときは通す (11/01 10 件。❌Red: 止める側の 4 件。PowerShell からの commit ・ 失敗した commit は区切りにならない、も足した) | ✅ **済** |
| 3 | 実装して、node ・ bun とも全件 ✅Green (11/01 140 件) | ✅ **済** |
| 4 | `~/.claude/settings.json` の PreToolUse に matcher `Bash\|PowerShell` で登録し (控えは `tmp/`)、登録したコマンドそのままで試走する (11/01 登録。この会話の記録で試走し、Edit の失敗が後の Edit で解けていたため通った) | ✅ **済** |
| 5 | フックの README に行を足し、html2md ・ check-contrast を通す (11/01 指摘なし ・ 読めない配色なし) | ✅ **済** |
| 6 | 次のセッションで、実環境から確かめる (失敗した Edit の後の commit が止まる ・ Read の後は通る) | ⬜ **未** |
| 7 | 依頼元 (20261019-file-manager) に、完成したことと、サンプルを消してよいことを知らせる (利用者の指示、11/01) | ⬜ **未** |
| 8 | この計画と課題に結果を足す | ⬜ **未** |

## 5. 決めることの一覧

| # | 決めること | 選択肢 | 推す案 |
|---:|---|---|---|
| 3 | 失敗の印を何で解くか | A. 同じファイルへの Edit ・ Write が通るか、Read が通る<br>B. Edit ・ Write が通るときだけ<br>C. A に加え、止められた後の同じ commit の打ち直しで通す | **A (決定)**。Read で確かめる流れが、「直した」の報告に行を添えるルールと合い、誤って止める場面が最も少ない |
| 4 | 止め方 | A. `deny` で止め、ファイル名と解き方を書く<br>B. `ask` で利用者に聞く | **A (決定)**。既存のガードと同じ止め方。Read 1 回で解ける |
| 5 | ファイルの置き方 | A. 単独のファイルで、PreToolUse に 1 行足す<br>B. PreToolUse を 1 つの入口にまとめる | **A (決定)**。既存のガードも 1 目的 1 ファイルで、matcher も違う |

[トップへ戻る](../../README.md)
