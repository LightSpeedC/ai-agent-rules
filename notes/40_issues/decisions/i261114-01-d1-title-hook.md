---
schema: 1
id: i261114-01-d1
title: 422: タイトルの色をフックで支えるか
parent: i261114-01
decided: 2026-11-14
chosen: A
---

## 案

- A: UserPromptSubmit フックで毎回 1 行促す (恒久寄り)
- B: Stop フックで、問いで終えたのに付け替えていなければ止める
- C: ルールの文だけ (暫定)
