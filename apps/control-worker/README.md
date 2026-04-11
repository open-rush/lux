# @rush/control-worker

pg-boss 任务编排 + RunStateMachine 驱动。三层架构的中间层。

## 职责

- 消费 pg-boss 队列
  - `run:execute` — 驱动 Run 全生命周期
  - `run:finalize` — 流结束后的 finalization 子状态机
  - `run:recover` — 每 2 分钟检测并恢复卡住的 Run
- 驱动 RunStateMachine（15 状态转换，乐观锁）
- 沙箱生命周期（通过 SandboxProvider 创建/销毁/健康检查）
- Agent Bridge（消费 SSE① 流，持久化 run_events）
- Finalization 强一致性门（snapshot + checkpoint + PR + metadata）

## 不做

- 不处理 HTTP 请求（交给 web）
- 不渲染 UI
- 不执行 AI 调用（交给 agent-worker）

## 依赖

`@rush/control-plane`, `@rush/sandbox`, `@rush/db`, `@rush/stream`, `@rush/contracts`, `pg-boss`
