---
schema: 1
id: i261115-02
title: subst ドライブの節の理由から、REA の MCP が W: 側で読まれない、を外す
group: 他プロジェクトからのルール変更依頼（2026-11-07 起票）
created: 2026-11-15
from: 20261020-research-ai-agent
confirmed: true
refs: #2005, #2013
---

20261020-research-ai-agent の報告 #2013 で、W: 側のセッションでも、起動直後は接続中だっただけで、のちに mcp__rea__* が出て list_architectures に応答が返っていた。#2002 の「W: 側では読まれない見込み」は誤りで、W: 側・C:/work 側のどちらでも rea は使える。共通ルール「subst のドライブで開いたセッションは、実体のパスで開き直す」(rules/workflow-record-rules.md) の理由に、REA の MCP の登録が W: 側に読まれない、と書いてあるため、この理由が成り立たない。残る理由は claude ランチャが W: のカレントで止まる件だけ。節ごと残すか・理由を直すか・外すかは、利用者の判断。

## やること
- [済] rules/workflow-record-rules.md の節「subst のドライブで開いたセッションは…」の理由から REA の件を外した。20261020-research-ai-agent へ返信して確認待ち
