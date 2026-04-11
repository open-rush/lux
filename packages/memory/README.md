# @rush/memory

跨会话 Agent 记忆。pgvector 向量搜索 + 全文检索。

## 规划子模块

```
src/
├── store.ts                 # 记忆存储（写入 + 更新 + 自动压缩）
├── search.ts                # 混合搜索（向量相似度 + BM25 全文 + 时间衰减）
├── extractor.ts             # 对话后记忆自动提取
└── index.ts
```

## 依赖

`@rush/db`（pgvector 查询）, `@rush/contracts`
