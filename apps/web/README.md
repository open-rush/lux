# @rush/web

Next.js 16 前端 + Control API + SSE② 端点。三层架构的用户入口。

## 职责

- 用户界面渲染（React 19, App Router）
- Control API（POST /api/runs 创建运行、GET /api/runs/:id 查询状态）
- SSE② 端点（将 run_events 流式推送给浏览器，支持 resumable-stream 断线重连）
- 项目/用户 CRUD（直接操作 @rush/db）
- NextAuth.js v5 认证

## 不做

- 不执行 AI 模型调用（交给 agent-worker）
- 不操作沙箱文件系统（交给 control-worker 通过 SandboxProvider）
- 不处理 Run 状态机转换（交给 control-worker）

## 依赖

`@rush/control-plane`, `@rush/db`, `@rush/stream`, `@rush/contracts`
