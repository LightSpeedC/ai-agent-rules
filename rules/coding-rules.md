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
- **新しいファイルを Write する前に、同じ名前のファイルが無いかを確かめる**。一度読んだファイルは、Write が止めずに上書きする
- **ps1 を Write で書いたら BOM と CRLF を入れ直す**（`--to ps1`）。Write は BOM無し LF で書く
- **HTML を Write で書いたら BOM を入れ直す**（`--to html`）
- **Edit は UTF-8 なら安全**。BOM の有無・LF / CRLF とも維持され、追加した行も元の改行に揃う。`old_string` は LF で書いてよい
- **old_string は Read の出力から、行番号の後のタブ 1 つだけを除いて写す**。インデントのタブを空白で書かない

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
