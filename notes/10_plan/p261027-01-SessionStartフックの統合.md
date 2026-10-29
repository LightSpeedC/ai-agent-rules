# SessionStart フックを 1 本にまとめる

対象: ai-agent-rules ／ 入力: SessionStart の標準入力 (JSON) と Vault ／ 出力: 1 つの JSON (systemMessage と additionalContext) と、会話ログの写し。今は 3 本に分かれているフックを、入口 1 本にまとめる。

> 📅 作成: 2026-10-27 / 更新: 2026-10-29

[トップへ戻る](../../README.md)

## 目次

1. [目的](#1-目的)
2. [現状](#2-現状)
3. [設計](#3-設計)
4. [手順](#4-手順)
5. [決めることの一覧](#5-決めることの一覧)

## 1. 目的

SessionStart で動くフック 3 本を、入口 1 本にまとめる。出力も JSON 1 つにまとめ、開始時刻の行を 1 回だけ入れる。重複排除への対策を 1 か所で済ませ、node の起動回数も減らす。

## 2. 現状

- `~/.claude/settings.json` の SessionStart に 3 本を登録している: `load-obsidian-memory.ts` ・ `copy-session-jsonl.ts` ・ `remind-resume.ts`
- 3 本とも、毎回違う開始時刻の行を `additionalContext` に入れている。再開では、会話にある文と同じだと Claude Code が捨てるため (重複排除)
- `copy-session-jsonl.ts` は Stop にも登録している
- REA の `claude-config/settings.json` にも同じ登録がある
- 再開の案内の文言は「指示を待たずに張り直す」となっている。しかしフックは応答を始められないので、張り直しが始まるのは、次の発言を受けてから (2026-10-27 の再開で確かめた)

## 3. 設計

### ファイルの分け方

- 入口 `session-start.ts` を新しく作る。標準入力を 1 回だけ読み、下の 3 つの関数を順に呼ぶ
- 今の 3 本の処理は、関数として切り出す。各関数は、`{ message?: string; context?: string }` を返す (表示する 1 行と、Claude へ渡す文)
    - 会話ログの写し: `jsonl-copy.ts`
    - Obsidian メモリ: `obsidian-memory.ts`
    - 再開の案内: `resume-reminder.ts`
- **動かす処理は、引数で名前を並べて選ぶ** (`session-start.ts copy obsidian resume`)。並べた順に呼ぶ。PC ごとの構成の違いは `settings.json` の引数だけで変える (実装中に利用者の提案で追加)
- 引数が無いとき、知らない名前があるときは、⚠️ を出す。引数が無ければ何も動かさない (決めることの 2)
- `copy-session-jsonl.ts` は、Stop 用の入口として残す。中身は `jsonl-copy.ts` を呼ぶだけにする
- `load-obsidian-memory.ts` と `remind-resume.ts` は、`settings.json` を切り替えて動きを確かめてから消す

### 出力

- JSON を 1 つだけ出す
- `systemMessage`: 3 つの表示を、今と同じ「絵文字 + 月/日 時:分 + 本文」の形のまま、改行でつなぐ
- `additionalContext`: 3 つの文を空行でつなぎ、最後に開始時刻の行を 1 回だけ入れる (`セッション開始: yyyy/mm/dd hh:mm:ss.ccc JST（写し先=…）（source=…）`)
- 呼ぶ順: 会話ログの写し → Obsidian メモリ → 再開の案内
- 1 つの関数が失敗しても、ほかの関数は続ける。失敗は ❌ の表示にする。終了コードは常に 0

### テスト

- 今のテストのうち、3 本を起動している分は、`session-start.ts` を起動する形に直す。期待値は変えない
- 新しく足すもの
    - 出力が JSON 1 つだけ
    - 開始時刻の行が 1 回だけ入る
    - Obsidian が失敗しても、会話ログの写しの表示と、再開の案内は出る
    - startup では再開の案内を出さず、resume ・ compact では出す
    - Stop 用の `copy-session-jsonl.ts` は、今と同じ動き (失敗のときだけ表示する)

### 登録

- `~/.claude/settings.json` の SessionStart を 1 行にする。Stop は変えない。書き換える前に、控えを `tmp/` に取る
- REA の `claude-config/settings.json` も同じように直す (ローカルルール「Claude フックの置き場とメンテ」)

## 4. 手順

| # | 作業 | 状態 |
|---:|---|---|
| 1 | この計画の承認と、決めることの 1 を決める (1 は A に決定) | ✅ **済** |
| 2 | テストを先に書き直す・足す。❌Red を確かめる | ✅ **済** |
| 3 | 関数への切り出しと `session-start.ts` を実装する。node ・ bun とも全件 ✅Green | ✅ **済** |
| 4 | `settings.json` のコマンドそのままで試走する | ✅ **済** |
| 5 | `~/.claude/settings.json` と REA の設定を書き換える | ✅ **済** |
| 6 | 実環境で、新規起動と再開の両方を見る (表示 3 行、注入文、写し) | ✅ **済** |
| 7 | 古い 2 本 (`load-obsidian-memory.ts` ・ `remind-resume.ts`) を消す | ✅ **済** |
| 8 | `tools/80_ops/claude-hooks/README.html` を直す。ローカルルールの「Claude フックの置き場とメンテ」の値も、文言を出して指示を受けてから直す | ✅ **済** |

## 5. 決めることの一覧

| # | 決めること | 選択肢 | 推す案 |
|---:|---|---|---|
| 1 | 再開の案内の文言 | A. 「次の発言を受けたら、本題の前に張り直す」に直す<br>B. 今のまま (「指示を待たずに張り直す」) | **A (決定)**。フックは応答を始められず、実際の動きと合う。B では、発言を待たずに張られると読めてしまう |
| 2 | 引数が無いときの動き | A. 何もせず、⚠️ を出して正常終了する<br>B. 3 つとも動かす | **A (決定)**。指定し忘れたときに黙って全部動かず、どれが動くかが設定から読める |

[トップへ戻る](../../README.md)
