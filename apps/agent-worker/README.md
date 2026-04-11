# @rush/agent-worker

Hono HTTP server（:8787），运行在沙箱容器内。

## 职责

- 接收 prompt 请求，调用 Claude Code 执行
- 工具执行（Bash, Read, Write, Edit 等 Claude Code 内置工具）
- SSE① 流式输出 UIMessageChunk 到 control-worker
- 断点恢复（POST /restore 接收 checkpoint 重建上下文）
- 工作区文件系统操作

## 约束

- **无状态**：所有恢复数据来自 DB/OSS，不依赖进程内存
- **凭据隔离**：通过 env 注入，不持有明文密钥
- **单租户**：每个沙箱容器运行一个 agent-worker 实例

## 依赖

`@rush/contracts`, `@rush/agent-runtime`, `hono`, `@hono/node-server`
