# コーディングルール

## 使用言語（Node / Bun）

適用条件: Node・Bun で動くコードを書くとき。

- **TypeScript（`.ts`）で書く**。node・bun ともに TypeScript を直接実行できる
- **優先順位は `ts` > `mjs` > `cjs`**。`ts` で書けない事情があるときだけ `mjs`、それも難しいときだけ `cjs` にする
- **node・bun は `.ts` を型チェックなしでそのまま実行する**。コンパイル・型チェックは行わない
- **開発時に `tsc` で型チェックを行う**。実行はできても型の誤りは実行時エラーにならないため、別途確認する

## インデント

- **インデントはTab文字を使用する**
- **`<pre>` の中身は空白で揃える**。タブは表示側の桁位置に依存するため、ツリーや SQL の見本が環境で崩れる。ここは字下げではなく表示である

## bat / cmdファイルの文字コード・改行コード

- **bat・cmdファイルはSJIS（Shift-JIS）＋CRLFで作成する**
- **違反を見つけたら、確認を取らずに直す**。直すのは `convert-encoding <path> --to cmd`

## 文字コード変換は1回だけ行う

適用条件: `convert-encoding` を使わずに手で変換するとき。ふだんはツールが判定を担う。

- **変換済みのファイルを再変換しない**。SJISのファイルをUTF-8として読み直すと不正バイトが `?` に置換され、日本語が破壊される
- ファイルを作り直したら変換も1回だけやり直す。既存ファイルを変換する場合は、先に現在のエンコーディングを判定する
- **道具が変換して出したものに、さらに変換をかけない**。`convert-encoding` ・ `psh` が UTF-8 で流した出力を `iconv` に通せば壊れる。**エラーは出ない**

## ツールごとの文字コードの扱い

適用条件: 既存ファイルを編集するとき、Write でファイルを作るとき。

| | UTF-8 BOM付き | UTF-8 BOM無し | SJIS |
|---|---|---|---|
| Grep | 正常 | 正常 | **見つからない** |
| Read | 正常 | 正常 | 文字化け |
| Edit | BOM・改行を保持 | 保持 | **破壊** |
| Write | **BOM消失・LF化** | そのまま | **破壊** |

- **SJIS のファイルは `text read` で読む**（範囲は `--lines`）。Read ツールは文字コードを指定できず、化けたまま返る
- **SJIS と UTF-16 のファイルは Grep から漏れる**。**0 件ではなく一部だけが返る**ので、結果を見ても欠けに気づけない。**一括置換のたびに bat・cmd・reg だけが取り残される**
- **ASCII の検索語なら当たることがある**。1 バイトの部分は一致するため。**日本語で検索したときだけ落ちる**
- **探すのは `text find`**。SJIS・UTF-16 も含めて当たる（`--include "*.cmd,*.reg"` で絞る）
- **SJIS のファイルを、SJIS のまま Edit で編集しない**。UTF-8 として読まれ、読めないバイトが U+FFFD になって書き戻される（**エラーは出ず、成功が返る**）。直すときは UTF-8 化してから（下の小節）
- **ps1 を Write で書いたら BOM と CRLF を入れ直す**（`--to ps1`）。Write は BOM無し LF で書く
- **HTML を Write で書いたら BOM を入れ直す**（`--to html`）
- **Edit は UTF-8 なら安全**。BOM の有無・LF / CRLF とも維持され、追加した行も元の改行に揃う。`old_string` は LF で書いてよい

変換は `convert-encoding` を使う（プロジェクトを問わず共通）。用途名を渡すと、文字コードと改行の両方が決まる。

```powershell
convert-encoding <path> --to ps1     # BOM 付き UTF-8 ＋ CRLF
convert-encoding <path> --to cmd     # SJIS（CP932）＋ CRLF
convert-encoding <path> --to html    # BOM 付き UTF-8 ＋ LF
```

- **手で組み立てない**。書き方がセッションごとに変わり、`WriteAllBytes` を使ってウイルス対策に検知された
- **変換先で表現できない文字があれば、書き換えずに止まる**。その文字と行番号が出る
- **変換後が元と同じならファイルに触らない**。何度実行してもよい
- 利用方法の詳細は `T:/ai-agent-tools/TOOLS-USAGE.md` を参照

### cmd・bat・reg を作る・直す・消す（Windows）

適用条件: SJIS の cmd・bat、UTF-16 の reg を作成・修正するとき。

- **作成**: 標準 Write で書く → `convert-encoding <path> --to cmd`（reg は `--to reg`）
- **修正**: `convert-encoding <path> --to utf8` → 標準 Edit → `convert-encoding <path> --to cmd`。**編集中は UTF-8 のまま。編集後すぐ戻す**（中断すると UTF-8 で残る）
- **読む**: `text read`（範囲は `--lines`）／ **探す**: `text find`
- **削除**: `Remove-Item`（文字コード無関係）。消す前に読むなら `text read`
- **これらは Windows 固有**。cmd・bat・reg は Windows のみ

## ps1（PowerShell）ファイルの文字コード・改行コード

- **ps1ファイルはBOM付きUTF-8＋CRLFで作成する**
- BOMが無いとWindows PowerShell 5.1で日本語が壊れる（pwsh 7では問題ない）。改行はLFでも動作するが、混在を避けるためCRLFに揃える
- **違反を見つけたら、確認を取らずに直す**。直すのは `convert-encoding <path> --to ps1`

## スクリプト内の表示メッセージ

- **ps1・bat等のスクリプトが標準出力に表示するメッセージ（進捗ログ・完了メッセージ等）は日本語で書く**

## 全角・半角混在のテキストを桁揃えするとき

適用条件: CLI のヘルプ表示など、日本語と英数字が混在する文字列を桁揃えするとき。

- **手でスペースを数えて決め打ちしない**。文字ごとの表示幅（ASCII・半角ｶﾀｶﾅは1桁、それ以外は2桁）を計算する関数を使い、目標桁数までパディングする
- **理由**: ラベルの文字を後から変更すると数え直しを忘れる。正しい表示幅も、コードを読むだけでは分からず実機で確認するまで誤りやすい（実際に踏んだ）

## アプリケーションログの日時形式

適用条件: サーバー・常駐プロセス等がプレーンテキスト形式のログを出力するとき（HTMLログは「HTML でログを出力する」に従う）。

- **日時はJST（日本標準時）とし、`yyyy/mm/dd hh:mm:ss.ccc`（cccはミリ秒3桁）で書く**。実行環境のタイムゾーン設定に関係なく常にJSTで出力する
- **日時部分を `[]` で囲まない**

## コンソールのコードページを変更しない

適用条件: スクリプト ・ プログラムを書くとき（cmd ・ bat ・ ps1 ・ C# ・ Node ・ Bun 等）。

- **コードページの変更は禁止**。次のどれも書かない
  - `chcp`（cmd ・ bat ・ ps1 の中）
  - `[Console]::OutputEncoding` ・ `[Console]::InputEncoding`（ps1）
  - `Console.OutputEncoding` ・ `Console.InputEncoding`（C#）
  - `SetConsoleOutputCP` ・ `SetConsoleCP`（Win32 API。FFI ・ P/Invoke 経由も含む）
- **一時的に変えて戻す形も禁止**。パイプで同時に動くと後の側が 65001 を元の値として控え、窓に残る。隣のプロセスは戻した後も化けたまま。C# は Ctrl+C で `finally` が走らない
- **理由は、窓のコードページが同じ窓の全プロセスで共有され、終わっても戻らないため**。同じ窓の SJIS の cmd ・ .NET Framework の exe が化ける
- **化けるのは受け手が UTF-8 のときだけ**。窓や PowerShell から実行すれば化けない
- **UTF-8 で渡すときは、リダイレクトされている分だけ自分の読み書きを差し替える**。3 本とも別に差し替える（ps1 も同じ API で書ける）

  ```csharp
  var utf8 = new UTF8Encoding(false);
  if (Console.IsOutputRedirected) Console.SetOut(new StreamWriter(Console.OpenStandardOutput(), utf8) { AutoFlush = true });
  if (Console.IsErrorRedirected)  Console.SetError(new StreamWriter(Console.OpenStandardError(), utf8) { AutoFlush = true });
  if (Console.IsInputRedirected)  Console.SetIn(new StreamReader(Console.OpenStandardInput(), utf8));
  ```

- **受け手が cmd（`more` ・ `findstr` ・ `for /f`）だと化ける**。人が読むなら `more` の代わりに `less`（ai-agent-tools）を使う
- **例外は 2 つ**。コードページそのものを確かめる検証の材料と、化けた窓を人が手で直す `chcp 932`。**検証の材料には外した理由をその場に書く**
- **化けた窓の見分け方**: 引数なしの `chcp` は入力側を表示するので数字は 932 のまま。メッセージが英語（`Active code page`）になる

## SetConsoleOutputCP は成功を返しても実際には効かないことがある

適用条件: Windows で `SetConsoleOutputCP` を使ってコンソールの出力コードページを変えようとするとき。

- **実機で確認した事実**: `SetConsoleOutputCP` は戻り値としては成功（true/非0）を返すが、`chcp` で見える値は変わらないことがある。`bun:ffi` 経由・PowerShell の P/Invoke 経由のどちらで呼んでも同じ結果だった（呼び出し方法の問題ではない）
- **関連する報告（未検証・参考情報）**: [microsoft/terminal #9174](https://github.com/microsoft/terminal/issues/9174) に、ConPTY（疑似コンソール）配下ではコードページの変換が疑似コンソール内部で行われ、外側には伝わらない、という報告がある。[PowerShell/PowerShell #14941](https://github.com/PowerShell/PowerShell/issues/14941) にも同様の報告がある。**自分の環境が実際にこれに該当するかどうかまでは確認していない**
- 戻り値（成功）だけで「効いた」と判断しない。変わったかどうかは `chcp` 等で実際に確認する
- **`chcp` が変わらないように見えたのは、`chcp` が入力側を表示するためかもしれない**（未検証）。出力側だけを変えても `chcp` は元の数字を表示したことを実測している（「コンソールのコードページを変更しない」）

## ps1作成時のcmdランチャー

- **ps1ファイルを新規作成する際は、必ずそのメイン処理をダブルクリックで実行できる同名のcmdランチャーを同じフォルダに用意する**（例: `foo.ps1` を作ったら `foo.cmd` も作る）
- **ユーザーが直接実行しない ps1 は対象外**
- ランチャーの内容は基本的に以下の形:
  ```
  @echo off
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0foo.ps1"
  pause
  ```

## bun と node で FFI を使うとき

適用条件: Windows API 等を JS/TS から直接呼ぶ実装を、bun と node の両方で動かすとき。

- **bun と node で使うライブラリが異なる**。bun は組み込みの `bun:ffi`、node は外部パッケージの `koffi` を使う（node に `bun:ffi` は無く、bun に `koffi` を入れる必要もない）
- **`bun:ffi` の import は文字列を組み立ててから動的 import する**。直に `import 'bun:ffi'` と書くと、node の型定義には無いモジュールのため tsc の検査が止まる。実行時に解決すればよいので、`'bun' + ':ffi'` のように分けてから `await import(...)` する
- **実行時に bun か node かを判定し、両方の実装を用意して使い分ける**。どちらも失敗したら、さらに緩い手段（外部コマンドの起動等）へフォールバックする

## Bun 同士のパイプは文字化けすることがある（未解決）

適用条件: Bun で実行しているプログラムの出力を、別の Bun プログラムへパイプで渡すとき。

- **開始時のコンソールのコードページが UTF-8（65001）でないと、Bun ランタイム自体が文字化けを起こす**（実機で確認。bun:ffi 等、呼び出し側のコードは無関係）。`bun -e "console.log(...)" | bun -e "process.stdin.pipe(process.stdout)"` という、呼び出し側のコードを一切含まない最小構成でも再現し、実行後コードページが 65001 に変わる副作用を伴う。node が片方にでも入っていれば起きない
- Bun 側の未解決バグとして報告済み（[oven-sh/bun#43660](https://github.com/oven-sh/bun/issues/43660)）。**回避策は、パイプの少なくとも片方を Bun 以外のランタイムにする**（node 等）
- **bun は動いている間だけ、窓の入力・出力を 65001 にして、終了時に戻す**（実測。node は触らない）。「コンソールのコードページを変更しない」で避けた形と同じで、パイプで同時に動く・強制終了で窓に 65001 が残りうる

## 同期 API は、そのプロセスの非同期処理を止める

適用条件: node ・ bun で `〜Sync` の付く API を使うとき。

- **イベントループは 1 本しかない**。`〜Sync` が返るまで、**同じプロセスの非同期処理は 1 つも進まない**
- **待ちを含む処理ほど危ない**。子プロセスの実行、ネットワーク越しの応答、大きなファイルの読み書き。**止めている長さが、そのまま他の遅れになる**
- **待ち合わせる相手が同じプロセスにいると噛み合う**。子は応答を待ち、親は子の終了を待つ。**例外は出ず、ただ固まる**
- **同期で呼ぶなら `timeout` を必ず付ける**。固まったことに気づける唯一の手段
- **テストで最も起きやすい**。サーバーを同じプロセスで立てるため

## プロセスの識別性（本番/テストの区別）

適用条件: 同じサーバーを複数インスタンス（本番・テスト等）で同時に起動しうるとき。

- **区別に使う情報（ポート番号等）はコマンドライン引数で渡す**（例: `--port 8081`）。環境変数は `tasklist` 等の外部プロセス一覧に表示されず、どちらが本番か判別できずkillを誤る
- **`process.title` にも同じ情報を反映する**（例: `intra-proxy:8081`）。`tasklist /v` のウィンドウタイトル列でも判別できるようにする
