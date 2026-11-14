---
schema: 1
id: i261114-04-d1
title: 425: 見張りではない grep を拾う件の直し方
parent: i261114-04
decided: 2026-11-14
chosen: A
---

## 案

- A: grep は --line-buffered 付きだけ見張りとして拾う (恒久)
- B: 同じ頃に起きた -f 付きの tail と組のときだけ拾う
- C: grep は拾わず tail -f と見張りの powershell だけにする
