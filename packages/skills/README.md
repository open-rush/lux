# @rush/skills

Agent Skill 系统。安装、管理、注册。

## 规划子模块

```
src/
├── installer.ts             # Skill 动态安装（下载 tarball → 解压 → 验证）
├── registry.ts              # Skill 注册表查询
└── index.ts
```

## 依赖

`@rush/contracts`
