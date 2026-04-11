# Rush

**Enterprise AI agent infrastructure — self-hosted, multi-scenario, built for every team member.**

## Why Rush

Every enterprise is figuring out how to put AI agents to work. The options today: lock into a vendor's cloud, stitch together fragile toolchains, or build from scratch.

Rush takes a different path. **Deploy once into your own infrastructure, then let everyone — developers and non-developers alike — use AI agents for their daily work.** Developers automate through CLI and API. Product teams build apps through conversation. Data teams analyze through natural language. All running on sandboxed Claude Code agents, with credentials encrypted, permissions enforced, and data never leaving your network.

We believe the future of enterprise software is not "AI features bolted onto existing tools" — it's **AI agents as the primary interface**, with the right infrastructure underneath: sandboxed execution, credential security, plugin extensibility, and observable operations.

Rush is that infrastructure, open-source.

## Vision

```
                              Rush
                    ┌──────────────────────┐
                    │   AI Agent Platform   │
Entry Points        │                      │        Scenarios
                    │  ┌────────────────┐  │
 Web UI (everyone)──┤  │ Orchestration  │  ├──► Web app building
 CLI (developers)───┤  │ Sandbox        │  ├──► Code generation
 API (systems)──────┤  │ Skills & MCP   │  ├──► Data analysis
 SDK (embedded)─────┤  │ Memory         │  ├──► Workflow automation
                    │  │ Vault          │  ├──► Document generation
                    │  │ Observability  │  ├──► Multimodal tasks
                    │  └────────────────┘  │
                    └──────────────────────┘
                         Your infrastructure
```

**Current scope (M0–M4):** Platform layer + web app building + Web UI. CLI, API, SDK, and more scenarios follow post-GA.

## Architecture

Three-layer design with pluggable sandbox isolation:

```
Browser / CLI / API
  │
  │  SSE (streaming)
  ▼
apps/web (Next.js 16)          — Portal + Control API
  │
  │  pg-boss queue
  ▼
apps/control-worker             — Orchestration + 15-state machine
  │
  │  SandboxProvider interface
  ▼
Sandbox Container
  ├── apps/agent-worker (Hono)  — Claude Code execution
  ├── Workspace files
  └── Dev server
```

## Platform Capabilities

| Capability | Description |
|-----------|-------------|
| **Agent orchestration** | Conversation, task dispatch, state machine, checkpoint recovery |
| **Sandbox isolation** | Per-task containers, pluggable runtime (OpenSandbox, E2B, Docker...) |
| **Skills & MCP** | Plugin marketplace + Model Context Protocol servers |
| **Memory** | Cross-session learning, user preferences, vector search |
| **Vault** | Dual-layer credentials — platform (admin) + user (self-service), auto-secured injection |
| **Multi-tenant** | Per-user projects, RBAC, isolated workspaces |
| **Observability** | OpenTelemetry traces + metrics + LLM cost tracking |

## Design Principles

- **Self-hosted first** — your data, your infrastructure, your rules
- **Pluggable sandbox** — `SandboxProvider` interface, bring your own container runtime
- **Claude Code native** — three connection modes: Anthropic API / AWS Bedrock / custom endpoint
- **Security by default** — Credential Proxy for zero-secret containers, dual-layer Vault
- **Zero vendor lock-in** — standard OTEL, NextAuth.js, S3-compatible storage, Drizzle ORM

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16, React 19, Tailwind 4, shadcn/ui |
| Backend | Hono (agent), pg-boss (queue), Drizzle ORM |
| AI | Claude Code (Anthropic API / Bedrock / custom endpoint) |
| Database | PostgreSQL 16 + pgvector |
| Sandbox | Pluggable via SandboxProvider |
| Cache | Redis (resumable SSE) |
| Storage | S3-compatible (MinIO / AWS) |
| Auth | NextAuth.js v5 |
| Observability | OpenTelemetry |

## Milestones

| Milestone | Target | Focus |
|-----------|--------|-------|
| M0: Skeleton | Week 2 | Infrastructure, sandbox PoC, security baseline |
| M1: Agent Loop | Week 5 | Claude Code in sandbox, streaming to browser |
| M2a: MVP Core | Week 9 | Create → chat → code → preview → deploy |
| M2b: Experience | Week 11 | AI components, Vault, templates |
| M3: Ecosystem | Week 15 | Skills, MCP, Memory |
| M4: GA | Week 18 | OTEL, RBAC, E2E, docs, production hardening |

See [Roadmap](docs/roadmap.md) for the full plan.

## Getting Started

```bash
# Prerequisites: Node.js 22+, pnpm, Docker

docker compose up -d    # PostgreSQL, Redis, MinIO, sandbox server
pnpm install
pnpm build && pnpm check && pnpm test && pnpm lint
```

## Contributing

We're building this in the open. Contributions welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) (coming soon).

## License

[MIT](LICENSE)
