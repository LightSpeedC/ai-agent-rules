# フックを Obsidianメモリ連携ルールに合わせる

課題 i261018-01（#1548、ai-obsidian-vault からの依頼）。SessionStart のフックで Vault を同期してから目次 2 つを注入し、Stop のフックで daily の追記を促して `safe-push` で同期する。

> 📅 作成: 2026-10-18 / 更新: 2026-10-18

[トップへ戻る](../../README.md)

## 目次

1. [目的](#1-目的)
2. [現状](#2-現状)
3. [設計](#3-設計)
4. [手順](#4-手順)
5. [決めることの一覧](#5-決めることの一覧)

## 1. 目的

共通ルール「Obsidianメモリ連携ルール」が求める動き（MCP を使わない・projects の登録・daily の追記・Stop フックによる同期）を、このプロジェクトの Claude フックで実現する。依頼元が示した、ルールに無い決め事は次のとおり。

- 同期は `safe-push <Vault> --all`。SessionStart で同期に失敗しても、注入は続ける
- SessionStart で `projects/!projects.md` も注入する。注入文から MCP の記述を消す
- 未登録の判定に使うプロジェクト名は `CLAUDE_PROJECT_DIR` のフォルダ名、無ければ `cwd`。Vault 自体も特別扱いしない
- daily の追記を促すのは、最後の追記から 6 時間以上空いたとき

## 2. 現状

| イベント | フック | していること |
|---|---|---|
| SessionStart | `load-obsidian-memory.ts` | `memory/!memory.md` を注入する。注入文が「obsidian-mcp MCP または Read で読む」と案内している（ルールと食い違い） |
| SessionStart・Stop | `copy-session-jsonl.ts` | 会話ログをプロジェクトの `etc/history/jsonl/` へ写す（今回は変えない） |

`~/.claude/settings.json` の Stop には `copy-session-jsonl.ts` しか無い。**ルールが「Stop フックが行う」とする Vault の commit・push は、今どこでも行われていない**。Vault の書きかけが溜まっていたのはこのためと見られる（2026-10-18 に、commit 前の変更が 3 件残っていた）。

## 3. 設計

### SessionStart（`load-obsidian-memory.ts` を直す）

1. 環境変数 `AI_AGENT_OBSIDIAN_VAULT` が無ければ、今までどおり何もしない
2. `safe-push <Vault> --all` で同期する（ほかの PC の分を取り込む）。失敗しても、表示に残して先へ進む
3. `memory/!memory.md` と `projects/!projects.md` を注入する。片方が無ければ、ある方だけ
4. プロジェクト名（`CLAUDE_PROJECT_DIR` のフォルダ名、無ければ `cwd` のフォルダ名）の `projects/<名前>.md` が無ければ、注入文に「未登録なので登録する」旨を足す
5. 注入文から MCP の記述を消し、「Vault のファイルを直接読み書きする。書き方は共通ルール『Obsidianメモリ連携ルール』」と案内する

注入文に手順を写さない（共通ルール「手順は 1 箇所に置く」）。見出し名で指すだけにする。

### Stop（新しく `sync-obsidian-vault.ts` を作る）

1. 環境変数が無ければ何もしない
2. daily の最後の追記（`daily/` の中で最も新しいファイルの更新日時）から 6 時間以上空いていれば、追記を促す（促し方は決めることの 1）
3. `safe-push <Vault> --all` で同期する。成功は表示しない（Stop は応答のたびに走るため）。失敗したときだけ表示する

`safe-push` の終了コード（0 成功・ロックで飛ばした、1 失敗、3 衝突、4 push 失敗、5 引数の誤り）を、そのまま表示の文言に対応させる。Stop の終了コード 2 は「続ける」と読まれるので、フック自身は常に 0 で終わる。

### `settings.json`

- Stop に `sync-obsidian-vault.ts` を足す
- SessionStart の `load-obsidian-memory.ts` の `timeout`（今は 15 秒）を、同期の分だけ延ばす（決めることの 2）

### テスト

テストを先に書く。Vault は `tmp/` に作った裸のリポジトリと clone で代える（共通ルール「git を使うテストの材料」）。本物の Vault には触らない。

- 注入文に MCP の記述が無い。`!memory.md` と `!projects.md` の両方が入る
- 未登録のプロジェクトでは登録を促す文が入り、登録済みなら入らない。Vault 自体も同じ扱い
- 同期が失敗しても注入は行われる
- daily の最後の追記が 6 時間以上前なら促し、6 時間未満なら促さない
- Stop の同期が成功したときは何も表示せず、失敗したときだけ表示する
- 環境変数が無ければ、どちらのフックも何もしない

## 4. 手順

| # | 作業 | 状態 |
|---:|---|---|
| 1 | この計画の承認と、決めることの 1〜3 を決める<br>済: 2026-10-20、3 点とも A | ✅ **済** |
| 2 | テストを先に書き、❌Red を確かめる<br>済: 新しい 16 件のうち 13 件が落ちた（3 件は今の実装でも当てはまる内容）。偽の `safe-push` を PATH の先頭に置き、本物の Vault・GitHub に触れない | ✅ **済** |
| 3 | `load-obsidian-memory.ts` を直し、`sync-obsidian-vault.ts` を作る。node・bun とも全件 ✅Green<br>済: 2 つが共有する処理は `vault.ts`（入力の読み取り・プロジェクト名・`safe-push` の呼び出し）。node・bun とも 52 件 ✅Green | ✅ **済** |
| 4 | `settings.json` の hooks を書き換え、コマンドそのままで試走する<br>済: Stop に `sync-obsidian-vault.ts`（timeout 30 秒）を足し、SessionStart の `load-obsidian-memory.ts` の timeout を 30 秒にした。書き換える前の控えを `tmp/` に取った。試走で、SessionStart は同期してから 2 つの目次を注入し、Stop は daily の追記を `decision: block` で促した（`stop_hook_active` のときは同期だけ） | ✅ **済** |
| 5 | 実環境のフック（セッションの開き直し・応答の終わり）から動かして結果を見る<br>済（Stop）: 2026-10-20 08:43、書き換えた直後の応答の終わりに、動いているセッションのままで daily の追記を促した（`settings.json` の Stop の追加は、開き直さなくても効いた）。追記したあとの Stop で `safe-push` が Vault を commit・push した（`safe-push 2026/10/20 08:43:41`、GitHub と一致）<br>未（SessionStart）: セッションを開き直したときに、同期と注入を確かめる | ⚠️ **着手** |
| 6 | `tools/80_ops/claude-hooks/README.html` とローカルルール「Claude フックの置き場とメンテ」を直す | ⬜ **未** |
| 7 | ai-obsidian-vault に済んだことを知らせ、確認を受けてから課題を済にする | ⬜ **未** |

## 5. 決めることの一覧

| # | 決めること | 選択肢 | 推す案 |
|---:|---|---|---|
| 1 | daily の追記の促し方 | A. Stop で `decision: "block"` を返し、理由に「daily に追記する」と書く（Claude がその場で追記してから止まる）<br>B. `systemMessage` で利用者に表示するだけ | **A**。ルールは「Stop フックが促す」としており、Claude に届かなければ追記されない。6 時間に 1 回なので、応答が長引くのもその回だけ |
| 2 | SessionStart の `timeout` | A. 30 秒<br>B. 15 秒のまま（同期が間に合わなければ注入ごと落ちる） | **A**。`safe-push` はロック待ちだけで最大 9 秒かかる。15 秒では、push まで含めると足りないおそれがある |
| 3 | Stop の同期をどのファイルに置くか | A. 新しい `sync-obsidian-vault.ts`<br>B. `copy-session-jsonl.ts` に足す | **A**。会話ログの写しと Vault の同期は別の役目で、片方が失敗しても、もう片方を止めない |

`decision: "block"` の振る舞い（Stop で返すと Claude が続ける）は Claude Code の公式ドキュメントの記述に基づく。この環境では未検証で、手順 4・5 で確かめる。

[トップへ戻る](../../README.md)
