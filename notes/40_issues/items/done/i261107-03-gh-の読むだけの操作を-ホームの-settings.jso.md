---
schema: 1
id: i261107-03
title: gh の読むだけの操作を、ホームの settings.json で許可しておく
group: 他プロジェクトからのルール変更依頼（2026-11-07 起票）
created: 2026-11-07
---

11/07 に 20261011-claude-code-setup から依頼を受けた (セッション間のメッセージ、その利用者の指示)。Linux の VM で gh repo view ・ list ・ clone のたびに許可を求められ、「don't ask again」でもプロジェクトの `.claude/settings.local.json` にしか残らない。`~/.claude/settings.json` の `permissions.allow` に `Bash(gh repo view:*)` ・ `Bash(gh repo list:*)` ・ `Bash(gh repo clone:*)` を入れる決まりを共通ルールに足す。gh repo create ・ edit など GitHub に残る操作は許可に入れない。置き場の候補は i261107-02 の近くか、light-git の「リモートリポジトリの作成・push」の近く。文言と置き場はこちらで決める。

**やること**

- [済] 利用者の了承を得て、文言の案を差分で出し、「反映して」を待って書き込む (skill light-git に小見出し「gh の読むだけの操作はホームで許可する」を足し、説明文にも足した。11/07)
- [済] 周知し、依頼元 (20261011-claude-code-setup) の確認を受ける (#1820 と SendMessage で周知し、依頼元から OK を受けた。11/07)
