---
schema: 1
id: i261031-02
title: format-detection の meta が 15 ファイルに無い
group: 品質レビュー q261031-01 の指摘（2026-10-31）
created: 2026-10-31
---

品質レビュー（[q261031-01](../../../80_quality_review/q261031-01-品質レビュー.md)）の指摘。HTML 20 本のうち、`<meta name="format-detection" content="telephone=no">` があるのは 5 本だけ（10/31 に Grep で数えた）。共通ルール「HTMLデザインルール」の「その他」。

**やること**

- [済] 15 本の `<head>` に足す
