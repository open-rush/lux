# @rush/control-plane

业务逻辑层。Run 编排、Agent 管理、事件存储。

## 规划子模块

```
src/
├── run-service.ts           # Run 生命周期（创建、状态转换、重试、PR URL 持久化）
├── agent-service.ts         # Agent 管理（创建/查询、checkpoint 写入）
├── event-store.ts           # 事件流（追加 run_events、从事件重建对话消息）
├── run-state-machine.ts     # 15 状态转换 + 乐观锁（WHERE status = currentStatus）
├── finalization.ts          # 4 步 finalization 子状态机
└── index.ts
```

## 依赖

`@rush/contracts`, `@rush/db`
