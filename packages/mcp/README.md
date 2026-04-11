# @rush/mcp

Model Context Protocol server/client。

## 规划子模块

```
src/
├── server.ts                # MCP Server（暴露工具给 Agent）
├── client.ts                # MCP Client（连接外部 MCP Server）
├── types.ts                 # MCP 协议类型
└── index.ts
```

## 依赖

`@rush/contracts`
