# GitHub Pages 公開ルール

適用条件: リポジトリの内容を GitHub Pages で公開するとき。

## 前提

- **private リポジトリの Pages は有料プラン限定**。無料プランで公開するには public が必要になる。可視性の決め方と公開後の `gh repo edit --homepage` は「リモートリポジトリの作成・push」に従う
- **description の扱いは「リモートリポジトリの作成・push」に従う**

## 公開の準備

- **エントリポイントの `index.html` を置く**。実体が `README.html` なら、そこへ 0 秒でリダイレクトするだけの中身にする。3 段構えにする: `location.replace()`（履歴を残さない）／ `meta http-equiv="refresh" content="0; url=..."`（JavaScript 無効時）／ 本文のリンク（両方効かない場合の手動フォールバック）
- **`.nojekyll` を置く**。Jekyll のビルドを無効化する
- `.gitignore` で除外したものは配信されない。公開したいファイルが除外対象になっていないか確認する

## 有効化

- ソースはブランチとパスを明示する

```powershell
echo '{"source":{"branch":"develop","path":"/"}}' | gh api repos/OWNER/REPO/pages -X POST --input -
```

- 有効化直後は `status` が `null`／`building`。**`built` になるまで待ってから公開を報告する**

```powershell
gh api repos/OWNER/REPO/pages --jq .status
gh api repos/OWNER/REPO/pages/builds/latest --jq ".status, .error.message"
```

- **Pages を有効化したら、続けて Enforce HTTPS も同じ流れで実行する**。別指示を待たない

## 公開 URL は実測で確かめる

- **`<user>.github.io/<repo>` をそのまま公開 URL として案内しない**。ユーザーサイト（`<user>.github.io` リポジトリ）にカスタムドメインが設定されていると、project pages も `<customdomain>/<repo>` へ 301 される
- **このアカウントには独自ドメインが設定済み。全プロジェクトの Pages はそのドメイン配下になる**
- API が返す `html_url` を確認し、さらに実際に HTTP で叩いて到達先を確かめる

```powershell
gh api repos/OWNER/REPO/pages --jq .html_url
```

- ルート・実体の HTML・画像が 200 で返ることを確認する

## Enforce HTTPS（HTTPS を強制）

- **`https_enforced` はリポジトリ単位の設定**。ユーザーサイトで有効でも project pages には引き継がれないので、リポジトリごとに有効化する

```powershell
echo '{"https_enforced":true}' | gh api repos/OWNER/REPO/pages -X PUT --input -
```

- **アカウント全体に効くのは cname（カスタムドメイン）だけ**。「ドメイン全体に影響する」「別リポジトリを触る必要がある」と判断する前に、リポジトリ単位の設定でないかを確認する
- TLS 証明書はドメイン単位で発行される。有効化前に `https_certificate.state` が `approved` かを確認する。未発行のまま有効化するとサイトに到達できなくなる

```powershell
gh api repos/OWNER/USER.github.io/pages --jq ".https_certificate.state, .https_certificate.domains"
```

- 有効化後、http でのアクセスが https へ 301 されることを実測する

## push のあとに公開を確かめる

適用条件: GitHub Pages を公開しているリポジトリへ push したとき。

- **push したら、Pages の作り直しが終わるのを待ち、反映されたかを確かめてから報告する**。`gh api repos/OWNER/REPO/pages/builds/latest` の `commit` が push した commit になり、`status` が `built` になるまで待つ
- **反映は公開 URL で実測する**。変えたファイルを 1 つ取り、変更が入っていることを見る
- **作り直しが失敗していたら、理由を `gh run view` で確かめ、`gh run rerun <run id>` で流し直す**。push 済みの中身をもう一度出すだけなので、確認は要らない
- **流し直すのは、中身と関係ない失敗のときだけ**（ランナーが割り当てられない等）。ビルドのエラーなら流し直さずに報告する
- **混雑すると、順番待ち（queued）のまま 15 分ほどで失敗になる**。待つ間は別の作業を進め、区切りで確かめ直す
- **流し直しても反映されなければ、報告して止める**。GitHub 側の障害は待つほかない

## 公開したら lightspeedc.com への掲載を依頼する

適用条件: GitHub Pages を公開したとき。

- **依頼先は `:lightspeedc.github.io:`**。ルームは `public`。送り方は「ai-chat-lite（AI 間チャット）の利用」に従う
- **依頼の前に、既に載っていないかを確かめる**。載っていれば依頼しない
- **載っていても、掲載の内容（リンク先・説明）が実態と合わなくなったら依頼し直す**
- **先に `gh repo edit --description` を済ませる**。掲載時の説明は GitHub の description が転記される
- 本文はこの形にする

```text
依頼: lightspeedc.github.io の1章または2章に、新しく公開したプロジェクトを追加してください。

- プロジェクト: <README の見出し>
- 公開URL: https://lightspeedc.com/<リポジトリ名>/
- リポジトリ: https://github.com/LightSpeedC/<リポジトリ名>
```

- **説明文を本文に書かない**。description と二重になる
- **掲載場所を指定しない**
