# Agent-0 Foundation 进度

## 总览
负责 M1 六个任务(schema + contracts + auth middleware)。严格串行执行。

## task-1 Schema agent_definition_versions + agents 字段
- **状态**: ✅ 完成,等待合并
- **分支**: `feat/task-1`
- **文件域**: `packages/db/src/schema/agents.ts`, `packages/db/src/schema/agent-definition-versions.ts`, `packages/db/drizzle/0009_agent_definition_versions.sql`, 相关测试 + pglite helper 更新
- **关键决策**:
  - 新增 `agent_definition_versions` 表,FK `agent_id → agents.id ON DELETE CASCADE`,`created_by → users.id ON DELETE SET NULL`。
  - `agents` 表扩两列:`current_version integer NOT NULL DEFAULT 1`、`archived_at timestamptz`。
  - Migration 中使用 `to_jsonb(agents.*) - 'id' - 'created_at' - ...` 剥掉 metadata/runtime 字段,符合 spec §初次 migration。
  - 采用手写 migration SQL 而非 drizzle-kit 生成,因现有 journal 在 0007/0008 已存在 snapshot 漂移(0007 无 snapshot,0008 snapshot 未反映其变更);drizzle-kit 生成的会尝试重建已有的 tasks/mcp_* 等表。
  - 同步更新 `packages/db/test/pglite-helpers.ts` + `packages/control-plane/src/__tests__/*` 三处 agents 表 DDL(加两列),保证所有依赖 PGlite 的测试不挂。
  - 测试覆盖:unique 约束、同 agent 单调递增、不同 agent 可共用版本号、FK cascade、FK set null、default 行为、migration 回填 v1 snapshot。
- **已知问题**:`docs/execution/verify.sh` 使用了错误的 scope 名 `@openrush/db`(实际是 `@open-rush/db`),task-specific filter 是 no-op。由于 verify.sh 是受保护文件,不修改;通用 `pnpm test` 已覆盖本任务全部测试。
- **验证结果**: `pnpm build/check/lint/test` 全绿;`./docs/execution/verify.sh task-1` PASS(69 个 db 测试通过)。

## task-2 Schema service_tokens
- **状态**: ✅ 完成,等待合并
- **分支**: `feat/task-2`
- **文件域**: `packages/db/src/schema/service-tokens.ts`(新)、`packages/db/drizzle/0010_service_tokens.sql`(新)、`packages/db/test/pglite-helpers.ts`(加 DDL + TABLE_NAMES)、`packages/db/src/__tests__/{service-tokens,schema,migration}.test.ts`。
- **关键决策**:
  - token_hash `text NOT NULL` + 全局 UNIQUE(hash 冲突在任何 user 之间都是 bug)。
  - `service_tokens_active_idx` partial index on `token_hash WHERE revoked_at IS NULL`,对齐 spec 和 authenticate() 的快速路径。
  - owner_user_id FK CASCADE on DELETE。
  - scopes jsonb 默认 `'[]'::jsonb`。
  - 测试覆盖:defaults、scopes ordering、hash 存储形式(64 hex、不含明文)、UNIQUE 冲突、NOT NULL(用 raw SQL 绕过 TS)、FK 违反、CASCADE、active predicate(正常/revocation/expiry/混合)、partial index 存在性 + predicate 文本。
  - migration.test 验证 `service_tokens_active_idx` 的 `WHERE revoked_at IS NULL` predicate 实际在 pg_indexes 中生效。
- **drizzle journal 纠偏**:task-1 遗留了 phantom `0010_chemical_namorita` 条目(源自我本地 regenerate 时没清理干净),本次生成 `0011` 文件。已手动:
  - 把 `0011_neat_loa.sql` 重命名为 `0010_service_tokens.sql`
  - 把 `0011_snapshot.json` 重命名为 `0010_snapshot.json`
  - 删除 journal 中 phantom `0010_chemical_namorita` 条目
  - 0010 snapshot 的 prevId 正好等于 0009 snapshot 的 id,链完整
  - `drizzle-kit generate` 确认无 drift("nothing to migrate")
- **验证结果**: `pnpm build/check/lint/test` 全绿;`./docs/execution/verify.sh task-2` PASS(87 个 db 测试通过,service-tokens filter 真正生效)。

## task-3 Schema runs extension + tasks.definition_version
- **状态**: ✅ 完成,等待合并
- **分支**: `feat/task-3`
- **文件域**: `packages/db/src/schema/runs.ts`、`packages/db/src/schema/tasks.ts`、`packages/db/drizzle/0011_runs_versioning_idempotency.sql`(新,drizzle-kit 生成后手工加回填 SQL)、`packages/db/test/pglite-helpers.ts`、`packages/control-plane/src/__tests__/drizzle-{event-store,run-db}.test.ts`、`packages/db/src/__tests__/runs-extension.test.ts`(新)
- **字段**:
  - tasks.definition_version `integer`(nullable,应用层强校验,不落 DB 组合 FK)
  - runs.agent_definition_version `integer`(nullable 以兼容回填,新 run 由 RunService 在 task-11 填)
  - runs.idempotency_key `varchar(255)`
  - runs.idempotency_request_hash `varchar(64)`
- **索引**:
  - `runs_idempotency_lookup_idx` partial index on `runs(idempotency_key, created_at DESC) WHERE idempotency_key IS NOT NULL`
  - 明确不做 UNIQUE,避免"永久冲突"语义(24h 窗口由应用层保证)
- **回填 SQL**(三段):
  1. `UPDATE tasks SET definition_version = 1 WHERE agent_id IS NOT NULL AND definition_version IS NULL`
  2. `UPDATE runs SET agent_definition_version = t.definition_version FROM tasks t WHERE runs.task_id = t.id AND runs.agent_definition_version IS NULL`
  3. `UPDATE runs SET agent_definition_version = a.current_version FROM agents a WHERE runs.agent_id = a.id AND runs.agent_definition_version IS NULL`(兜底)
- **测试覆盖**:字段默认/nullable、idempotency_key 非 UNIQUE(允许重复 insert)、latest-first 查询、24h 窗口断言、partial index predicate 文本、三段回填 SQL 正确性(含 no agent_id / no task_id 兜底),以及(task_id, definition_version)一致性由应用层保证、DB 不做约束。
- **同步更新 control-plane pglite 测试 helper**:加 3 个新字段到 runs DDL,否则 DrizzleRunDb 插入会失败。
- **验证结果**:`pnpm build/check/lint/test` 全绿;`./docs/execution/verify.sh task-3` PASS(101 个 db 测试,runs filter 生效)。

## task-4 Contracts /api/v1/* Zod types(关键里程碑)
- **状态**: ✅ 完成,等待合并
- **分支**: `feat/task-4`
- **文件域**: `packages/contracts/src/v1/*`(新子目录 8 文件 + 7 测试文件 + index barrel)、`packages/contracts/src/index.ts` re-export。
- **组织策略**:按 endpoint 功能分 7 个文件 + 1 个 common:`common / auth / agent-definitions / agents / runs / vaults / registry / projects`。index.ts re-export + 根 index 用 `export * as v1 from './v1/index.js'` 命名空间化,避免和内部 schema 同名冲突(如 Run、Project 在内外层都存在)。
- **关键决策**:
  - **AI SDK UIMessagePart 不 import `ai` 包**:spec 写的是 `@ai-sdk/ui-utils`,实际在本仓库这个 tag 下是 `ai` 包。直接加 `ai` 依赖会把 React 等重依赖拖进 contracts(contracts 是 sdk / agent-worker / control-plane 的共同依赖)。改用结构兼容的 Zod schema 定义(`text / reasoning / step-start / tool-* / source-url / file / data-*`),运行时由 Zod 做 shape 验证,编译时消费方按需 `import type { UIMessagePart } from 'ai'`。此决策在 runs.ts 文件里写了长注释说明原因。
  - **Open-rush 扩展事件 discriminated union**:4 个字面量 type(`data-openrush-run-started/run-done/usage/sub-run`),精确 payload。`runEventPayloadSchema` 里 generic `data-*` 用 refine 拒绝 `data-openrush-*` 前缀,防止扩展事件 shape 被泛型 generic 吞掉(测试里专门断言)。
  - **pagination 用 `coerce.number` + 默认 50**;cursor opaque 字符串;response 带 `nextCursor: string | null`(spec 明确是 nullable)。
  - **ServiceTokenScope 枚举不含 `'*'`**:强制在 schema 层面拒绝 Service Token 声明 `*`,避免后续 API handler 需要额外过滤。额外导出 `AuthScope = ServiceTokenScope | '*'` 用于中间件 AuthContext。
  - **错误 code 枚举严格 8 个**,并导出 `ERROR_CODE_HTTP_STATUS` 常量映射给 route handler 用。
  - **PATCH body refine**:要求至少一个可编辑字段(`changeNote` 单独不算),避免 no-op PATCH 产生版本号递增。
  - **If-Match header** 用独立 `ifMatchHeaderSchema`(coerce → positive int)。**Idempotency-Key header** 用独立 `idempotencyKeyHeaderSchema`(≤255 URL-safe),对齐 0011 migration 的 `varchar(255)` 列宽。
  - **deleteAgentResponseSchema 的 status 用 `z.literal('cancelled')`**,契约上锁死 DELETE 只能返回 cancelled 状态。
  - **createVaultEntryRequestSchema** 用 refine 约束 `(scope, projectId)` 组合合法性,在 schema 层面就拒绝非法组合。
- **测试覆盖**:8 个测试文件共 355 tests,每个 schema 都有 happy + 错误路径。重点覆盖:scope `*` 拒绝、幂等 key 格式、SSE 事件 data-openrush-* 前缀保护、vault `(scope, projectId)` refine、PATCH no-op 拒绝、SSE id ≥ 1、分页 nextCursor 必传。
- **不包含**:OpenAPI 生成(按 team-lead 指示跳过,留 task-15);实际 hash 计算 / 中间件逻辑(task-5/11)。
- **验证结果**:`pnpm build/check/lint/test` 全绿;`./docs/execution/verify.sh task-4` PASS(355 contracts tests + 全量 test 正常)。

## M1 Milestone
所有 task-1/2/3/4 完成后,M1(Foundation)结束。Agent-A (M2) 和 Agent-B (M3) 可并行启动。

---

## 交接(Agent-0 下线,新 agent 接 task-5 + task-6)

Agent-0 在 task-4 PR #139 后 context 约 55-60%,按规则必换。此小节给接班 agent 用,只记决策 / 契约 / 坑。不贴代码或 diff。

### 当前状态快照

- M1 schema 全部 merged:agent_definition_versions / service_tokens / runs+tasks 扩展
- M1 contracts v1 全部完成:24 endpoint Zod schema(PR #139 pending merge)
- **Agent-A / Agent-B 仍阻塞**在 task-4 merge 上。一旦 #139 进 main,他们可并行启动。
- Agent-0 剩余:task-5(unified auth middleware) + task-6(auth tokens CRUD API)

### task-5: Unified Auth Middleware

**文件域**:`apps/web/lib/auth/unified-auth.ts` + `unified-auth.test.ts`。**不要**改动 contracts / db / control-plane。

**契约**(消费 `@open-rush/contracts` v1 的现成类型):

```typescript
// 用 @open-rush/contracts 的 v1.AuthScope / v1.ServiceTokenScope
// 不要重新定义这些枚举。
type AuthContext = {
  userId: string;
  scopes: v1.AuthScope[];       // ['*'] for session, 显式 list for token
  authType: 'session' | 'service-token';
};

authenticate(req: Request): Promise<AuthContext | null>
hasScope(ctx: AuthContext, required: v1.ServiceTokenScope): boolean
```

**实现要点**:

1. **Authorization header 先检查 `Bearer sk_*`**
   - 提取 raw token,`createHash('sha256').update(raw).digest('hex')` 算 hash
   - 查 `service_tokens WHERE token_hash = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`
   - 找不到 → return null
   - 找到 → 异步 `update service_tokens set last_used_at = now() where id = ?`(**不 await,不阻塞请求**),return AuthContext

2. **否则走 NextAuth session**
   - 项目 Next.js 16 Route Handlers 拿 session 的方式需要先查已有 route。参见 `apps/web/app/api/skills/*/route.ts` 或 `apps/web/app/api/projects/*/route.ts` 里怎么用 `auth()` / `getServerSession`。沿用同一 helper。
   - 有 session → AuthContext { userId, scopes: ['*'], authType: 'session' }

3. **两者都没有 → return null**

4. **hasScope**:`ctx.scopes.includes('*') || ctx.scopes.includes(required)`

**测试覆盖**(`apps/web/lib/auth/unified-auth.test.ts`,必须全部覆盖):
- 有效 session → authType='session', scopes=['*']
- 有效 service-token → authType='service-token', scopes=<显式>
- 无 Authorization + 无 cookie → null
- service-token revoked → null
- service-token expired → null
- service-token 不存在 → null
- lastUsedAt 更新不阻塞(用 fake timer 或 mock DB 断言异步)
- hasScope session 通配 `*`
- hasScope service-token 显式匹配
- hasScope service-token 不匹配 → false

**坑**:
- NextAuth session 的获取方式:**先 grep 现有 route**(`apps/web/app/api/`)看用的是 `auth()` 还是 `getServerSession()`。Next.js 16 + NextAuth v5 有两种写法,沿用已有的。
- **明文 token 不进日志**。任何 `console.log(authHeader)` / `logger.info({ token })` 都是违反铁律。
- Plaintext token 长度可能超过 varchar(255):sk_ + base64url(32bytes) ≈ 47 字符,合规。但接收方不要把明文落任何表。

### task-6: POST/GET/DELETE /api/v1/auth/tokens

**文件域**:`apps/web/app/api/v1/auth/tokens/route.ts`(POST+GET)、`apps/web/app/api/v1/auth/tokens/[id]/route.ts`(DELETE)、service 层可选新建 `apps/web/lib/auth/service-token-service.ts`(复用利于 task-5 / 未来 SDK)。

**消费 contracts**(task-4 已就位):
- `v1.createTokenRequestSchema` / `v1.createTokenResponseSchema`
- `v1.listTokensResponseSchema` / `v1.tokenListItemSchema`
- `v1.deleteTokenParamsSchema` / `v1.deleteTokenResponseSchema`
- `v1.errorResponseSchema` + `v1.ErrorCode` + `v1.ERROR_CODE_HTTP_STATUS`

**POST `/api/v1/auth/tokens`**:

1. 调 `authenticate(req)`,**拒绝 service-token 自颁发** → 401/`UNAUTHORIZED`(spec §颁发流程 前置条件)
2. `createTokenRequestSchema.parse(body)` — schema 已经拒绝 scopes 含 `*`、expiresAt 过去 / > 90 天(task-4 superRefine 已内置,**不要在 route 重新校验**)
3. 额外 service 层护栏:同 user 存活 token ≤ 20
   - query `SELECT count(*) FROM service_tokens WHERE owner_user_id = ? AND revoked_at IS NULL`
   - ≥ 20 → 400/`VALIDATION_ERROR`,hint="revoke an existing token first"
4. 生成明文:`'sk_' + randomBytes(32).toString('base64url')`
5. hash:`createHash('sha256').update(raw).digest('hex')`
6. insert service_tokens(token_hash, name, owner_user_id, scopes, expires_at)
7. 返回 201,body 含 `data: { id, token: <明文>, name, scopes, createdAt, expiresAt }` — **此次唯一一次明文出现**

**GET `/api/v1/auth/tokens`**:

1. `authenticate(req)`,允许 session 和 service-token(但只返回自己的)
2. `v1.paginationQuerySchema.parse(query)`
3. query `WHERE owner_user_id = ?`,按 created_at DESC,limit/cursor
4. 返回 paginated envelope,row shape = `tokenListItemSchema`(**不含 token、不含 token_hash**)

**DELETE `/api/v1/auth/tokens/:id`**:

1. `authenticate(req)` + ownership 校验(token.owner_user_id == auth.userId)
2. 软删:`UPDATE service_tokens SET revoked_at = now() WHERE id = ? AND owner_user_id = ? AND revoked_at IS NULL`
3. 幂等:已吊销再 DELETE 同一 ID → 200 返回已有 revoked_at(不再写入)
4. 物理保留行

**测试**(`apps/web/app/api/v1/auth/tokens/__tests__/route.test.ts` + `[id]/route.test.ts`):
- POST session 成功 → 201 + 明文 token 返回
- POST service-token auth → 401(禁止自颁发)
- POST body.scopes 含 `*` → 400(但其实是 schema 层 VALIDATION_ERROR,确认 error code)
- POST expiresAt 过去 → 400
- POST expiresAt > 90 天 → 400
- POST 第 21 个 → 400 hint 要求吊销
- GET 列表 → 无 token 字段 / 无 token_hash 字段(grep assertion)
- GET 分页 cursor
- GET service-token auth → 允许,只列该 owner 的
- DELETE 自己的 → revoked_at 设置
- DELETE 别人的 → 403/`FORBIDDEN`
- DELETE 不存在的 → 404/`NOT_FOUND`
- DELETE 已吊销的 → 200 幂等

### repo 隐性约定(我踩过的坑)

1. **pnpm filter 带连字符**:`@open-rush/db`(不是 `@openrush/db`)。verify.sh 已经在 task-2 前修过,现在正确。若新增 workspace package 记得用连字符命名。

2. **pglite test helper ↔ drizzle schema 双写**:
   - `packages/db/test/pglite-helpers.ts` 里的 inline `CREATE TABLE` 要与 drizzle schema 同步。
   - 同步还有两处:`packages/control-plane/src/__tests__/drizzle-event-store.test.ts`、`drizzle-run-db.test.ts` — 这俩文件自己写 inline CREATE,加字段时三处都改。
   - **坑**:如果只改 drizzle schema 没改 pglite helper,db 测试通过,但 control-plane 测试失败。

3. **drizzle-kit generate 有 phantom journal entry 问题**:
   - 本地跑过 `pnpm drizzle-kit generate` 后如果中途删了 SQL 文件,journal 里会留幽灵条目。
   - **push 前必 diff** `packages/db/drizzle/meta/_journal.json`,确认没多余条目。
   - 命名:drizzle 自动生成 random tag(如 `0011_young_supreme_intelligence`),你要手动 rename 文件 + 改 journal tag 为语义名(如 `0011_runs_versioning_idempotency`)。

4. **biome 自动格式化**:
   - `pnpm format` 会自动 fix import 排序、括号等
   - 不要手动调整 import 顺序
   - pre-commit lint-staged 会跑 biome check,格式不过 commit 不给过

5. **git pre-commit hook 绝不跳过**:
   - `--no-verify` 违反 AGENTS.md 铁律
   - 如果 hook 失败,修好再重新 commit,不要 `--no-verify`

6. **Sparring 是铁律**:
   - 每个 commit 前必须跑 `agent --print --trust --model gpt-5.3-codex-xhigh` 审
   - APPROVE 或仅 NIT → 继续
   - MUST-FIX / SHOULD-FIX → 修复再审
   - 最多 5 轮,超了升级 team-lead

7. **受保护文件清单**(不得 edit):
   - `.claude/plans/managed-agents-p0-p1.md`
   - `docs/execution/verify.sh`(已修过 scope bug,现在正确)
   - `specs/managed-agents-api.md` / `specs/agent-definition-versioning.md` / `specs/service-token-auth.md`
   - `docs/execution/TASKS.md`(只允许勾 checkbox,不改描述)
   - 需要改这些 → 立刻 SendMessage team-lead 停手

### Contracts v1 消费速查表

所有 Zod schema 都在 `@open-rush/contracts`(task-4 合入后),有两种 import 方式:

```typescript
// 方式 A:具名 import(最常用)
import {
  createTokenRequestSchema,
  errorResponseSchema,
  ErrorCode,
  AuthScope,
  ERROR_CODE_HTTP_STATUS,
} from '@open-rush/contracts';

// 方式 B:v1 namespace(避免和内部 Run/Project 同名冲突时)
import { v1 } from '@open-rush/contracts';
v1.createTokenRequestSchema.parse(body);
```

每个 schema 都导出了 `z.infer` 类型,直接用:

```typescript
import type { CreateTokenRequest, TokenListItem, AuthContext } from '@open-rush/contracts';
```

route handler 典型模式:

```typescript
const auth = await authenticate(req);
if (!auth) return Response.json({
  error: { code: 'UNAUTHORIZED', message: 'auth required' }
}, { status: ERROR_CODE_HTTP_STATUS.UNAUTHORIZED });

if (auth.authType === 'service-token') return Response.json({
  error: { code: 'FORBIDDEN', message: 'session required' }
}, { status: ERROR_CODE_HTTP_STATUS.FORBIDDEN });

const parsed = createTokenRequestSchema.safeParse(await req.json());
if (!parsed.success) return Response.json({
  error: {
    code: 'VALIDATION_ERROR',
    message: 'invalid body',
    issues: parsed.error.issues.map(i => ({ path: i.path, message: i.message })),
  },
}, { status: ERROR_CODE_HTTP_STATUS.VALIDATION_ERROR });

// ... 业务
```

### Spec 刷新待办(不阻塞 task-5/6)

team-lead 会在 task-4 merge 后开 `chore/spec-align-ui-message-chunk`,把 `specs/managed-agents-api.md §事件 payload 类型` 从 AI SDK 3 风格更新到 AI SDK 6 UIMessageChunk。不影响 task-5/6,但 task-10/14 的 agent 要注意读的是更新后的 spec。

### 汇报节奏提醒

team-lead 期望:
- 开始每 task → SendMessage 一句话(预估工期)
- 卡住 / Sparring 第 3 轮未过 / 受保护文件冲突 → SendMessage 求助
- PR 创建 → SendMessage 带 URL
- context 过 50% → 主动汇报,过 70% 再汇报
- **task-4 PR merge 消息(Agent-0 职责)**:team-lead merge 后会发信号,Agent-0 要用明显标记回 "✅ **task-4 MERGED** — Agent-A/B 可启动"
