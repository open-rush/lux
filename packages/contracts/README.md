# @rush/contracts

所有核心数据类型的 Zod schema 定义。零运行时依赖（仅 Zod）。

contracts 是依赖图的根——所有其他 package 和 app 都依赖它，它不依赖任何内部包。

## 子模块

```
src/
├── enums.ts              # 所有枚举 + RunStatus 15 状态机 + VALID_RUN_TRANSITIONS
├── run.ts                # Run（含 retryCount<=maxRetries refine）、RunSpec
├── agent.ts              # Agent（status, customTitle, config）
├── project.ts            # Project、ProjectMember（role: owner|admin|member）
├── events.ts             # UIMessageChunk（16 种事件类型）、RunEvent（seq 序列化）
├── artifact.ts           # Artifact（kind: diff|patch|log|screenshot|build|report）
├── sandbox.ts            # SandboxInfo（status 6 态、providerType）
├── vault.ts              # VaultEntry（双向 scope refine 验证）
├── checkpoint.ts         # RunCheckpoint（degradedRecovery 标记）
├── api.ts                # CreateRunRequest/Response、ApiResponse
└── index.ts              # barrel export
```

## 关键设计

- **RunStatus 状态机**：15 个状态 + `VALID_RUN_TRANSITIONS` 转换表 + `isValidRunTransition()` 验证函数
- **TERMINAL_RUN_STATUSES**：仅 `['completed']`——failed 是可重试的，不是终态
- **VaultEntry**：Zod `.refine()` 强制 scope='platform' ↔ projectId=null 双向一致
- **Run**：`.refine()` 强制 retryCount <= maxRetries
- **日期字段**：全部使用 `z.coerce.date()` 支持 string/Date 互操作

## 用法

```typescript
import { Run, RunSpec, RunStatus, isValidRunTransition } from '@rush/contracts';

// 验证输入
const spec = RunSpec.parse({ prompt: 'Build a web app', projectId: uuid });

// 检查状态转换
if (isValidRunTransition('queued', 'provisioning')) { /* ... */ }
```

## 测试

94 个测试：枚举（48）+ schema（46），覆盖正常/边界/非法路径。
