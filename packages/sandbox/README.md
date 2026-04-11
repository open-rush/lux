# @rush/sandbox

SandboxProvider 接口 + OpenSandbox 默认实现。

## 规划子模块

```
src/
├── types.ts                 # SandboxProvider 接口定义
│                            #   - create(): 创建沙箱
│                            #   - destroy(): 销毁沙箱
│                            #   - get(): 查询状态
│                            #   - exec(): 在沙箱内执行命令
│                            #   - healthCheck(): 健康检查
├── opensandbox.ts           # OpenSandbox 默认实现（Docker-based）
└── index.ts
```

用户通过 `SANDBOX_PROVIDER=opensandbox|e2b|docker` 环境变量切换实现。

## 依赖

`@rush/contracts`
