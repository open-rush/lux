# @rush/db

Drizzle ORM schema + PostgreSQL client + 测试基础设施。

## 子模块

```
src/
├── schema/                      # 13 张表的 Drizzle ORM 定义
│   ├── users.ts                 # NextAuth: users（id, name, email, image）
│   ├── accounts.ts              # NextAuth: OAuth accounts（provider+providerAccountId 唯一）
│   ├── sessions.ts              # NextAuth: sessions（sessionToken 唯一）
│   ├── verification-tokens.ts   # NextAuth: magic link tokens（composite PK）
│   ├── projects.ts              # 项目（sandboxProvider, defaultModel, defaultConnectionMode）
│   ├── project-members.ts       # 项目成员（role: owner|admin|member, project+user 唯一）
│   ├── agents.ts                # Agent 实例（projectId, status, config jsonb）
│   ├── runs.ts                  # 运行（15 状态, parentRunId 自引用 FK, retryCount）
│   ├── run-events.ts            # 事件流（seq bigint, run+seq 唯一, schemaVersion）
│   ├── run-checkpoints.ts       # 断点恢复（messagesSnapshotRef, degradedRecovery）
│   ├── sandboxes.ts             # 沙箱实例（providerType, externalId, ttlSeconds）
│   ├── artifacts.ts             # 运行产物（kind, path, storagePath, checksum）
│   ├── vault-entries.ts         # 凭据（scope CHECK 双向约束 + platform 级 partial unique index）
│   └── index.ts                 # barrel export
├── client.ts                    # DB 连接 singleton（URL 一致性校验, 连接池）
└── index.ts                     # 顶层 barrel export（schema + client）

test/
├── pglite-helpers.ts            # PGlite 测试：创建实例、apply schema、truncate
└── factories.ts                 # 测试工厂：createTestUser/Project/Agent/Run/Event

drizzle.config.ts                # Drizzle Kit 配置（generate/push/migrate）
```

## 关键设计

- **vault_entries** 有两层唯一约束：`UNIQUE(scope, project_id, name)` + partial unique index `UNIQUE(scope, name) WHERE project_id IS NULL`
- **runs.parentRunId** 是自引用 FK（`ON DELETE SET NULL`），支持 follow-up run 链
- **client.ts** 是 singleton，重复调用 `getDbClient()` 时检查 URL 一致性，不同 URL 会报错
- **PGlite 测试** 在进程内跑真实 PostgreSQL（WASM），不需要 Docker

## 用法

```typescript
import { getDbClient, users, projects, runs } from '@rush/db';

const db = getDbClient(); // 需要 DATABASE_URL 环境变量
const allUsers = await db.select().from(users);
```

## 命令

```bash
pnpm test             # PGlite 测试（40 个，零 Docker）
pnpm db:push          # 推送 schema 到真实 DB
pnpm db:generate      # 生成 migration SQL
pnpm db:studio        # Drizzle Studio 可视化
```
