# Claude フック

Claude Code のフック（SessionStart・Stop）を TypeScript で持つ。`~/.claude/settings.json` がこのフォルダのファイルを直接指すので、コピーは要らない。

> 📅 作成: 2026-10-03 / 更新: 2026-10-31

[README](../../../README.md)

## フック

### 1. 置き場と役割

| ファイル | 役割 | 呼び出し元イベント |
|---|---|---|
| `session-start.ts` | SessionStart の入口。動かす処理を引数に名前で並べ、並べた順に呼ぶ（`copy`・`obsidian`・`resume`）。結果を JSON 1 つにまとめ、`additionalContext` の最後に開始時刻の行を 1 回だけ入れる。引数が無いとき・知らない名前は ⚠️ で知らせる（計画 p261027-01） | SessionStart |
| `copy-session-jsonl.ts` | Stop の入口。会話ログを写す（処理は `jsonl-copy.ts`）。成功は表示せず、失敗だけ表示する | Stop |
| `jsonl-copy.ts` | （`copy`）会話ログ（JSONL）を、プロジェクト直下の `etc/history/jsonl/` へコピーする。コピー元は `transcript_path` と同じフォルダの全 `*.jsonl`。サイズと更新日時が同じものは飛ばす。プロジェクト直下の決め方は、環境変数の詳細仕様の `CLAUDE_PROJECT_DIR` | （入口から呼ぶ） |
| `obsidian-memory.ts` | （`obsidian`）Vault を同期してから、`memory/!memory.md` と `projects/!projects.md` を `additionalContext` として注入する | （入口から呼ぶ） |
| `resume-reminder.ts` | （`resume`）再開（`resume`）・compact のとき、chat 待受けと cron の張り直しを促す。フックは応答を始められないので、「次の発言を受けたら、本題の前に張り直す」と書く。手順は共通ルールの見出し名で指す（課題 i261025-01） | （入口から呼ぶ） |
| `guard-bash-sed-awk.ts` | Bash のコマンドの区切りごとの先頭語が `sed`・`awk` なら deny し、理由に Edit・Read を書く。引数の中の語では止めないが、先頭語が `ssh` で、引数の中に `sed -i` (`-i.bak`・`-ni`・`--in-place` を含む) があれば deny する。ssh の `sed -i` は PowerShell ツールでも見る (手元の `sed`・`awk` を止めるのは Bash だけ)（課題 i261025-01・i261113-01） | PreToolUse（matcher `Bash\|PowerShell`） |
| `guard-english-before-tool.ts` | 直前のツールの結果（無ければターンの始め）より後のテキストに、英語だけのかたまりがあれば deny し、理由に、その文を「」で引用して (長ければ先頭 80 字) 「日本語訳を本文に書いてから呼び直す」と書く。1 つ前のツールが通っていれば、そのツールの前の文も読む (フックの時点では同じ応答の文がまだ記録に無いため)。止めた英文には印を付け、2 度は止めない。英文のあとに、その英文の先頭 30 字ほどを「」で引いた日本語のかたまりがあれば、訳済みとして通す。会話ログが読めなければ通す（課題 i261029-01・i261031-01・i261111-04・i261031-08） | PreToolUse（matcher なし） |
| `check-choice-numbers.ts` | 最後の応答に書いた選択肢の番号 (`NNN-A`。コードの中は除く) が、`issue choice next` の予約 (`~/.ai-agent-tools/numbers/uuid_<uuid>_*/choices/`) にも決定 (`decisions/`) にも無ければ、1 回だけ block して振り直しを促す。2 回目は知らせるだけ。`project-uuid.txt` の無いプロジェクトでは何もしない（課題 i261111-05） | Stop |
| `check-leftover-processes.ts` | このセッションが起こした `tail`・`grep`・見張りの形の powershell (`-Wait`・`-Tail`・`while`・`Start-Sleep`) が残っていれば、1 回だけ block して止めるよう促す。`tail` は `-f`・`-F`・`--follow` 付き、`grep` は `--line-buffered` 付きだけを見張りとみなす (パイプの途中の使い捨てを拾わないため)。本体 (claude-code の claude.exe) の子孫と、コマンド行にセッション ID を含む孤児を見る。親のいない見張りのうち、このセッションの本体より後に起きたものは、「別のセッションのものかもしれない」と 1 回だけ知らせる。親子と起動時刻は、共有 CLI の `psls --json` で取る（課題 i261111-06・i261114-04・i261111-08） | Stop |
| `guard-commit-after-failed-edit.ts` | git commit の前に会話ログを読み、失敗したままの Edit・Write があれば deny し、理由にファイル名と解き方を書く。印は、失敗の後の同じファイルへの Edit・Write か Read が通れば解ける。通った commit より前の失敗は見ない。入力に作業の置き場 (`cwd`) があれば、その外のパスの失敗は数えない (worktree の子が親の checkout のパスで失敗しても止まらない)。会話ログが読めなければ通す（課題 i261101-01・i261114-02） | PreToolUse（matcher `Bash\|PowerShell`） |
| `guard-screen-capture.ts` | 画面の範囲を撮る呼び出し（`CopyFromScreen`・`GetDC(0)`・`GetWindowDC(GetDesktopWindow())`）があれば deny し、窓だけを写す書き方を理由に書く。見るのは、コマンドと、そこに出た ps1・psm1・cs の中身、スクリプト（ps1・psm1・cs・cmd・bat）への Write・Edit の中身。入力が読めなければ通す（課題 i261101-02） | PreToolUse（matcher `Bash\|PowerShell\|Write\|Edit`） |
| `guard-utc-in-record.ts` | 作業記録（パスに `_config/` を含む `.html`）への Write・Edit で、新しく書く分に `UTC` があり同じ行に `JST` が無ければ deny し、JST に換算して書くよう理由に書く。元からある行（Edit の old_string）は見ない。入力が読めなければ通す（課題 i261108-01） | PreToolUse（matcher `Edit\|Write`） |
| `guard-generated-md.ts` | `.md` への Write・Edit で、同じフォルダに同じ名前の `.html`（正本）があれば deny し、正本を直して html2md で作り直すよう理由に書く。`.html` が無い `.md`（手で書く Markdown）は通す。入力が読めなければ通す（課題 i261108-03） | PreToolUse（matcher `Edit\|Write`） |
| `guard-git-add-all.ts` | Bash・PowerShell の `git add -A`・`--all`・`.` と `git commit -a`、`-- <パス>` でファイルを名指ししない `git commit` を deny し、名指しするよう理由に書く。引用符の中 (コミットメッセージ) の語は見ない（課題 i261109-01） | PreToolUse（matcher `Bash\|PowerShell`） |
| `guard-bash-cd.ts` | Bash の `cd`・`pushd` を deny し、絶対パスか `git -C` を使うよう理由に書く。引用符の中の語は見ない。PowerShell は見ない（課題 i261109-02） | PreToolUse（matcher `Bash\|PowerShell`） |
| `stop-cron-on-halt.ts` | 発言に「止めて」「止める」「中断」「ストップ」「区切りで止」があれば、`additionalContext` に、作業全体を止める指示なら CronList で確かめて CronDelete で消す・再び張るのは再開の指示のあと・特定のものを止める指示や止めることの説明なら消さない、と差し込む。「止めてよい」「止めても構わない」等の許可の言い回しは、先に取り除いて判定する。入力が読めない・prompt が無いときは何も出さない（課題 i261103-01） | UserPromptSubmit |
| `remind-title-color.ts` | 発言を受けるたびに、`additionalContext` に、セッションのタイトルの状態の色 (🟢🔴🟡🟠🔵) を `set_session_title` で付け替えるよう 1 行で差し込む。止めない。入力が読めない・prompt が無いときは何も出さない（課題 i261114-01、決定 422-A） | UserPromptSubmit |
| `japanese-check.ts` | 英語の判定 `isEnglishOnly`。コードブロック・コードスパン・URL・パスを除き、英字が 20 字以上で、日本語の字の数が英語の語の数より少なければ英語とみなす（課題 i261031-01）。`require-japanese.ts`（Stop）と `guard-english-before-tool.ts` が使う。`quoteEnglish` は、英語だけのかたまりを「」で囲んで並べ、止めるときの理由に添える (Stop も PreToolUse も。課題 i261111-04) | （各フックから呼ぶ） |
| `convert-after-write.ts` | Write で書いた ps1・html・cmd・bat を、`convert-encoding` で文字コードと改行を揃える（ps1 → ps1、html → html、cmd・bat → cmd）。成功は無表示、失敗は ❌ で書き換えなしを知らせる（依頼 #1672） | PostToolUse（matcher: Write） |

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

再開（`--continue` / `--resume`）では、`additionalContext` が会話にある分と同じだと、Claude Code が捨てる（重複排除。anthropics/claude-code の issue 96698）。そのため `session-start.ts` は、毎回違う開始時刻の行（`セッション開始: 2026/10/04 00:30:12.345 JST（写し先=git）（source=resume）` の形）を、`additionalContext` の最後に 1 回だけ入れる。Stop には付けない。

### 2. 設定

#### 環境変数

フックが読む環境変数 (`AI_AGENT_OBSIDIAN_VAULT` ・ `CLAUDE_PROJECT_DIR`) は、詳細仕様 [環境変数](../../../notes/50_spec/環境変数.md) に書いてある。

#### settings.json の書き方

`~/.claude/settings.json` の `hooks` から、このフォルダのファイルを直接呼ぶ。パスはその環境でのこのリポジトリの置き場にする。

```json
"command": "node \"W:/ai-agent-rules/tools/80_ops/claude-hooks/session-start.ts\" copy obsidian resume"
```

SessionStart は、この 1 行だけにする。Obsidian を使わない PC では `obsidian` を外すなど、構成の違いは引数だけで変える。待ち時間の上限（`timeout`）は 45 秒にする（Vault の同期に最大 25 秒かかるため）。

Node は、`.ts` を直接実行できる版（v22.18.0 以降、または v23.6.0 以降）が要る。手元の v26.10.0 では実測で動いた。

### 3. テスト

テストは `tests/claude-hooks.test.ts`。本番の `~/.claude` や Vault には触れず、`tmp/` の下だけで動く。`tools/40_test/run-tests.cmd` が、node と bun の両方で全件を実行する。

[README](../../../README.md)
