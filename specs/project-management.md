# Project Management Specification

项目 CRUD + 成员管理的 API 层和 UI。

## 设计原则

- 所有端点需 NextAuth session 认证
- 写操作需 owner/admin 角色校验（成员管理）
- 创建项目时自动添加创建者为 owner
- 软删除 + 恢复，永久删除需先软删除
- ProjectService / ProjectMemberService 已在 control-plane 实现，本次只补 Drizzle DB 层和 API

## API 端点

### POST /api/projects

创建项目。

**请求**:
```json
{
  "name": "My Project",
  "description": "optional",
  "sandboxProvider": "opensandbox",
  "defaultModel": "sonnet",
  "defaultConnectionMode": "anthropic"
}
```

**流程**:
1. 认证 → 401
2. Zod 验证 → 400
3. ProjectService.create() → 写入 DB
4. 自动 addMember(projectId, userId, 'owner')
5. 返回 201

**响应 201**: `{ success: true, data: Project }`

### GET /api/projects

列出当前用户的项目。

**响应 200**: `{ success: true, data: Project[] }`

### GET /api/projects/[id]

获取单个项目详情。需项目访问权限。

**响应 200**: `{ success: true, data: Project }`

### PATCH /api/projects/[id]

更新项目。需 owner/admin 角色。

**请求**: 同 POST，所有字段可选。

### DELETE /api/projects/[id]

软删除项目。需 owner 角色。

### POST /api/projects/[id]/members

添加成员。需 owner/admin 角色。

**请求**: `{ "userId": "uuid", "role": "member" }`

### GET /api/projects/[id]/members

列出项目成员。需项目访问权限。

### PATCH /api/projects/[id]/members/[userId]

更新成员角色。需 owner 角色。

**请求**: `{ "role": "admin" }`

### DELETE /api/projects/[id]/members/[userId]

移除成员。需 owner 角色。不能移除最后一个 owner。

## 错误码

| HTTP | code | 场景 |
|------|------|------|
| 401 | UNAUTHORIZED | 未登录 |
| 403 | FORBIDDEN | 无权操作 |
| 404 | NOT_FOUND | 项目/成员不存在 |
| 400 | VALIDATION_ERROR | 请求体不合法 |
| 409 | CONFLICT | 成员已存在 / 不能移除最后 owner |

## UI 页面

- `/dashboard` — 项目列表（卡片网格）+ 创建按钮
- `/projects/[id]` — 项目详情 + 对话入口
- `/projects/[id]/settings` — 项目设置 + 成员管理 + 危险区

## 测试要点

- [ ] DrizzleProjectDb: CRUD + 软删除 + 恢复
- [ ] DrizzleMembershipDb: 添加/更新角色/移除 + owner 保护
- [ ] API: 认证 + 权限 + 正常路径
- [ ] 创建项目 → 自动成为 owner
