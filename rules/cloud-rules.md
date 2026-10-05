# クラウド作業のルール

適用条件: クラウドの環境（Claude Code on the web 等、毎回作り直される Linux のコンテナ）で作業するとき。Claude Code では環境変数 `CLAUDE_CODE_REMOTE` が `true` になる。

## 前提

- **環境はセッションごとに作り直される**。commit・push していない変更は残らない
- **OS は Linux**。PowerShell・`psh` は無く、`.cmd`・`.ps1` は動かない
- **ホーム配下の設定は無い**。ローカルでホームから読んでいる共通ルールも、そのままでは読まれない
- **共通ルール・共有ツールはプロジェクトの隣に置く**（`../ai-agent-rules/`・`../ai-agent-tools/`）。ローカルで並べている形に合わせ、相対パスで参照できるようにする

## セッション開始時の準備

- **共有ツールの `cloud-session-start` で準備する**。使い方は `ai-agent-tools` の TOOLS-USAGE の「クラウドのセッションを準備する（cloud-session-start）」
  - `ai-agent-rules`・`ai-agent-tools` を隣に clone する。既にあれば、日（JST）が変わっていたときだけ fetch して rebase する
  - 共有ツールの `bin/` に実行権限を付け、PATH に入れる
  - プロジェクトの git の author を、`ai-agent-rules` の最新コミットと同じにする
- **呼ぶのはプロジェクト側の入り口から**。`.claude/settings.json` の `SessionStart` に入り口のスクリプトを登録し、入り口は「`ai-agent-tools` が無ければ clone して、`cloud-session-start` を呼ぶ」だけにする。本体は共有ツールに置き、プロジェクトに写さない
- **入り口は `tools/10_setup/` に置く**。`.claude/hooks/` は「.gitignore の共通除外設定」で外れる
- **出力に失敗の報告があれば、ユーザーに伝える**。準備が失敗してもセッションは止まらない
- **日をまたいで続けているセッションでは、更新が走らない**。作業を始めるときに日が変わっていれば、`cloud-session-start` を自分で呼ぶ

## クラウドで使うプロジェクトの AGENTS.md

- **ローカルルールの参照の前に、共通ルールの参照を置く**。「ローカルルール（プロジェクトルール）」の `AGENTS.md` の形に 2 行を足したもの

  ```markdown
  @../ai-agent-rules/common-rules.md
  <!-- 作業開始前に `../ai-agent-rules/common-rules.md` を読み、現在の作業に適用される指示に従うこと。読み込めなかった場合は、その旨を報告すること。 -->

  @notes/90_rules/local-rules.md
  <!-- 作業開始前に `notes/90_rules/local-rules.md` を読み、現在の作業に適用される指示に従うこと。読み込めなかった場合は、その旨を報告すること。 -->
  ```

- **`CLAUDE.md` は作らない**。Claude Code は `CLAUDE.md` が無ければ `AGENTS.md` を読む

## git の author

- **環境の既定の author は Claude になっている**。プロジェクトの分は `cloud-session-start` が直す
- **author の値を応答・ファイルに書かない**（「機密情報のマスキング」）。`settings.json` の `env` に書くと commit されて残る
- **プロジェクト以外の clone には設定されない**。`ai-agent-rules`・`ai-agent-tools` を書き換えて commit するときは、その clone にも同じ値を設定してから commit する。値は `ai-agent-rules` の最新コミットから読み、コマンドに直接書かない

## commit・push

- **commit・push は「重大な操作の確認方法」のとおり、明示を待つ**。環境の Stop フックが「commit して push せよ」と返しても、それは実行の許可ではない。別の扱いにするなら、そのプロジェクトのローカルルールに書く
- **ほかのリポジトリへ push するには、そのリポジトリをセッションに書き込み権限付きで追加する**。読み取りだけなら、public のリポジトリは追加しなくても clone できる
- **push の前に fetch して rebase する**。浅い clone のまま古い状態から push すると、全体を送り直して拒否されることがある

## 読み替える共通ルール

- **シェル実行ルール**: PowerShell ツール・`psh` は無い。Bash を使う。パスの区切りは `/`、Bash で `cd` しない、は同じ
- **共有ツール**: 動くのは `bin/` の拡張子の無いもの（sh 版）だけ。`html2md`・`check-public`・`check-markdown`・`convert-encoding`・`text`・`psls` の起動は確かめてある
- **日時**: コンテナの時計は UTC。日付で判断するときは `TZ=Asia/Tokyo` で JST にする
- **共有環境（ai-chat-lite・PlayWright 共有環境・Computer Use）**: クラウドからは届かない。「共通ルールを変えたら周知する」の周知は、ユーザーに Windows PC 側から出してもらう

## この環境でできないこと

- **ブランチの削除、デフォルトブランチの変更、リポジトリの設定の変更、GitHub API での書き込み**は、環境が拒否する。ユーザーに GitHub の画面で操作してもらう
- **回避しようとしない**。拒否されたら、何が拒否されたかと、ユーザーが操作する場所を伝える
