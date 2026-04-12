# Web API Specification

apps/web 的 Control API 层，提供浏览器创建 Run、查询状态、接收 SSE② 流式输出的 HTTP 端点。

## 设计原则

- 所有端点需 NextAuth session 认证（未登录 → 401）
- 所有端点校验资源归属（project membership / run 归属）→ 403
- 请求体通过 Zod schema 验证（contracts 中已定义的 RunSpec/CreateRunRequest）
- Web 层只做验证 + 入队 + 查询，不执行 AI 逻辑
- SSE② 端点从 run_events 表轮询事件，支持 Last-Event-ID 断线重连

## 端点

### POST /api/runs

创建 Run 并入队 pg-boss。

**请求**:
```json
{
  "prompt": "Build a todo app",
  "projectId": "uuid",
  "agentId": "uuid",          // 可选，不传则自动创建
  "connectionMode": "anthropic", // 可选
  "model": "sonnet",           // 可选
  "triggerSource": "user"      // 可选
}
```

**流程**:
1. 验证 NextAuth session → 401
2. Zod 验证 body（CreateRunRequest = RunSpec）→ 400
3. 验证 projectId 存在 → 404
4. 验证用户对 project 有访问权限（creator 或 member）→ 403
5. 如果传了 agentId → 验证 agent 属于该 project → 400
6. 如果未传 agentId → 为项目创建默认 agent，返回 isNewAgent=true
7. 调用 RunService.createRun() 写入 DB
8. pg-boss enqueue `run:execute` job
9. 返回 201

**响应 201**:
```json
{
  "success": true,
  "data": {
    "runId": "uuid",
    "agentId": "uuid",
    "isNewAgent": false
  }
}
```

**错误**:
| HTTP | code | 场景 |
|------|------|------|
| 401 | UNAUTHORIZED | 未登录 |
| 400 | VALIDATION_ERROR | body 不合法 |
| 400 | INVALID_AGENT | agentId 不属于 projectId |
| 403 | FORBIDDEN | 无项目访问权限 |
| 404 | PROJECT_NOT_FOUND | projectId 不存在 |

### GET /api/runs/[id]

查询 Run 状态。通过 run → agent → project 链路校验访问权限。

**响应 200**:
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "status": "running",
    "agentId": "uuid",
    "prompt": "...",
    "activeStreamId": "stream-xxx",
    "retryCount": 0,
    "errorMessage": null,
    "createdAt": "ISO",
    "startedAt": "ISO",
    "completedAt": null
  }
}
```

**错误**:
| HTTP | code | 场景 |
|------|------|------|
| 401 | UNAUTHORIZED | 未登录 |
| 403 | FORBIDDEN | 无访问权限 |
| 404 | RUN_NOT_FOUND | runId 不存在 |

### GET /api/runs/[id]/stream

SSE② 端点 — 从 run_events 表轮询流式事件，支持断线重连。

**请求头**:
- `Last-Event-ID`（可选）: 断线重连时浏览器自动携带，值为事件 seq（数字）

**流程**:
1. 验证 session → 401
2. 查找 Run → 404
3. 验证资源归属 → 403
4. 解析 `Last-Event-ID`（非数字视为已结束，直接返回 DONE）
5. 从 run_events 表按 seq 轮询事件
6. Run 到达终态后发送 `[DONE]` 并关闭流

**响应**: `text/event-stream`
```
id: 0
data: {"type":"text-delta","content":"Hello"}

id: 1
data: {"type":"tool-input-start","toolName":"Bash"}

data: [DONE]
```

**事件 ID 体系**:
- 业务事件：`id: {seq}`（非负整数，对应 run_events.seq）
- 结束标记：无 `id` 字段（不影响浏览器 `Last-Event-ID`）
- 浏览器重连时 `Last-Event-ID` 保持为最后一个业务事件的 seq，服务端正确跳过已发事件

**断线重连**:
- 浏览器自动在重连时携带 `Last-Event-ID`
- 服务端用此值跳过 seq ≤ lastEventId 的已发事件
- 非数字 `Last-Event-ID` → 返回仅含 `[DONE]` 的空流

**轮询策略**:
- 进行中的 Run：每 500ms 查询一次 run_events 新增事件
- 终态 Run：一次性 dump 所有事件后关闭

## pg-boss Job Schema

```typescript
// queue: 'run:execute'
{
  runId: string;   // Run UUID
  prompt: string;  // 用户 prompt
  agentId: string; // Agent UUID
}
```

## SSE① → run_events 持久化

RunOrchestrator 在消费 SSE① 时，实时持久化每个事件到 run_events 表：

```
SSE① 事件到达
  ↓
EventStore.append()     // 持久化到 run_events（幂等，by runId+seq）
```

SSE② 端点通过 run_events 表的 seq 字段轮询新事件，实现 control-worker → browser 的事件传递。

Run 表的 `activeStreamId` 字段在 RunOrchestrator 开始消费流时设置，供后续 StreamRegistry 实时加速使用（当前 MVP 不使用）。

## 测试要点

- [ ] POST /api/runs: 未登录 → 401
- [ ] POST /api/runs: body 非法 → 400
- [ ] POST /api/runs: projectId 不存在 → 404
- [ ] POST /api/runs: 无项目权限 → 403
- [ ] POST /api/runs: agentId 不属于 project → 400
- [ ] POST /api/runs: 正常创建 → 201 + runId
- [ ] POST /api/runs: 无 agentId → 自动创建 agent + isNewAgent=true
- [ ] GET /api/runs/[id]: 查询存在的 run → 200
- [ ] GET /api/runs/[id]: 不存在 → 404
- [ ] GET /api/runs/[id]: 无权限 → 403
- [ ] GET /api/runs/[id]/stream: SSE 流式输出 + 事件格式正确
- [ ] GET /api/runs/[id]/stream: 断线重连（Last-Event-ID 跳过已发事件）
- [ ] GET /api/runs/[id]/stream: 非数字 Last-Event-ID → 返回 DONE 空流
