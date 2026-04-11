# @rush/stream

Redis-backed 可恢复 SSE 流。基于 `resumable-stream` 库封装。

在三层架构中负责两层 SSE 的 Redis 持久化：
- SSE①：agent-worker → control-worker
- SSE②：control-api → browser

## 子模块

```
src/
├── redis-client.ts        # Redis 连接工厂
│                          #   - createRedisClient(): standalone 或 sentinel 模式
│                          #   - parseSentinelEndpoints(): 解析 "host1:port1,host2:port2"
│                          #   - hasSentinelConfig() / hasStandaloneConfig(): 配置检测
│                          #   - createRedisOptions(): 默认连接参数
│
├── stream-registry.ts     # StreamRegistry 类
│                          #   - createStream(): 发布新流到 Redis
│                          #   - resumeOrCreate(): 恢复已有流或创建新流
│                          #   - resume(): 仅恢复（支持 skipCharacters 断点续传）
│                          #   - exists() / isDone(): 检查流状态
│                          #   - invalidate(): 清理僵死流的 sentinel key
│                          #   - close(): 优雅关闭 Redis 连接
│
└── index.ts               # barrel export
```

## 关键设计

- **优雅降级**：Redis 不可用时 `createStreamRegistry()` 返回 null，调用方回退到 DB-only
- **双客户端**：publisher（写入）+ subscriber（pub/sub 监听），subscriber 的 `maxRetriesPerRequest` 设为 null
- **Sentinel 支持**：生产环境 HA，通过 `sentinels` + `masterName` 配置
- `resume()` 返回三种状态：`ReadableStream`（活跃）/ `null`（已完成）/ `undefined`（不存在）

## 用法

```typescript
import { createStreamRegistry } from '@rush/stream';

const registry = createStreamRegistry({ redisUrl: 'redis://localhost:6379' });
if (!registry) { /* Redis 不可用，降级 */ }

await registry.createStream('run-123', () => agentOutputStream);
const stream = await registry.resume('run-123', skipChars);
```

## 测试

31 个测试：redis-client（17，纯逻辑）+ stream-registry（14，mock Redis）。
