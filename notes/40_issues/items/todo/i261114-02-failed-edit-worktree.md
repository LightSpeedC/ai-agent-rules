---
schema: 1
id: i261114-02
title: 失敗したままの Edit の印が、worktree の外のパスの失敗で解けず commit を止める
group: Claude フック（#1383 起票、2026-10-08）
created: 2026-11-14
from: file-manager
confirmed: false
---

file-manager (親) のセッション間メッセージ (11/14)。worktree の子が、外 (親の checkout) の存在しないパスへの Edit に失敗すると、guard-commit-after-failed-edit がその絶対パスを覚え、worktree 内の同じ相対パスを Read しても解けず commit が止まった。印は同じ絶対パスの Edit・Write・Read でしか解けない (guard-commit-after-failed-edit.ts の 3・52 行目)。直し方の候補: 作業の置き場 (cwd) の外のパスの失敗は数えない、または同じ相対パスの成功で解く。
