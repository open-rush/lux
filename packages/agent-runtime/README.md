# @rush/agent-runtime

Agent 执行运行时。AI Provider 接口 + Claude Code 实现。

## 规划子模块

```
src/
├── types.ts                 # AIProvider 接口（prompt → UIMessageChunk stream）
├── claude-code.ts           # Claude Code 实现（Anthropic API / Bedrock / 自定义端点）
└── index.ts
```

## 依赖

`@rush/contracts`
