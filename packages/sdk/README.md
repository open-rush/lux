# @open-rush/sdk

TypeScript client for the Open-rush **Managed Agents API** (`/api/v1/*`).

- Thin HTTP wrapper — no business logic, no retries, no caching.
- Types come straight from `@open-rush/contracts` (the Zod source of truth), so the SDK and server contracts cannot drift without a compile error.
- Node ≥ 18, the browser, Bun, and Deno all supported (any runtime with `fetch` + `ReadableStream` + `TextDecoder`).

---

## Install

```bash
pnpm add @open-rush/sdk
# or
npm install @open-rush/sdk
```

## Quickstart

### With a Service Token (machine-to-machine)

```ts
import { OpenRushClient } from '@open-rush/sdk';

const client = new OpenRushClient({
  baseUrl: 'https://rush.example.com',
  token: process.env.OPEN_RUSH_TOKEN, // sk_...
});

// 1. Create an AgentDefinition (versioned blueprint)
const {
  data: definition,
} = await client.agentDefinitions.create({
  projectId: PROJECT_ID,
  name: 'code-reviewer',
  providerType: 'anthropic',
  model: 'claude-sonnet-4-5',
  allowedTools: ['Read', 'Grep'],
  skills: [],
  mcpServers: [],
  maxSteps: 50,
  deliveryMode: 'chat',
});

// 2. Create an Agent (instance) + its first Run
const {
  data: { agent, firstRunId },
} = await client.agents.create({
  definitionId: definition.id,
  projectId: PROJECT_ID,
  mode: 'chat',
  initialInput: 'Review the latest commit on main.',
});

// 3. Stream events until the run completes
for await (const ev of client.streamEvents({
  agentId: agent.id,
  runId: firstRunId!,
})) {
  if (ev.data.type === 'text-delta') {
    process.stdout.write(ev.data.delta ?? '');
  }
  if (ev.data.type === 'data-openrush-run-done') {
    console.log(`\n[run ${ev.data.data.status}]`);
  }
}
```

### With a session cookie (browser / same-origin)

Omit `token` — cookie handling is the runtime's job. Pass the current
origin as `baseUrl`:

```ts
// In a browser page served from rush.example.com:
const client = new OpenRushClient({ baseUrl: window.location.origin });
await client.agents.list();
```

On the server (e.g. a Next.js Route Handler running on the same origin
as the UI), pass the full origin the route should call — typically an
env var like `process.env.NEXT_PUBLIC_APP_URL`.

## API surface

Methods mirror `specs/managed-agents-api.md` §Endpoint 清单 1:1. Resource namespaces:

| Namespace              | Endpoints                                                        |
| ---------------------- | ---------------------------------------------------------------- |
| `client.authTokens`    | `create`, `list`, `delete`                                       |
| `client.agentDefinitions` | `create`, `list`, `get`, `patch`, `listVersions`, `archive`   |
| `client.agents`        | `create`, `list`, `get`, `delete`                                |
| `client.runs`          | `create` (idempotency-key), `list`, `get`, `cancel`              |
| `client.streamEvents`  | SSE `run_events` subscriber with `Last-Event-ID` reconnect       |
| `client.vaults`        | `create`, `list`, `delete`                                       |
| `client.skills`        | `list`                                                           |
| `client.mcps`          | `list`                                                           |
| `client.projects`      | `create`, `list`, `get`                                          |

All request / response types are imported directly from `@open-rush/contracts`; the SDK re-exports the `v1` namespace for convenience:

```ts
import { v1 } from '@open-rush/sdk';
const token: v1.CreatedToken = /* ... */;
```

## Idempotency

`POST /api/v1/agents/:agentId/runs` accepts an optional `Idempotency-Key` header. UUIDv4 is recommended:

```ts
import { randomUUID } from 'node:crypto';

const { data: run } = await client.runs.create(
  agent.id,
  { input: 'retry-safe message' },
  { idempotencyKey: randomUUID() }
);
```

Within a 24-hour window:

- Same key + same body → server replays the original 201
- Same key + different body → 409 `IDEMPOTENCY_CONFLICT`

Other POST endpoints are **not** idempotent in v0.1.

## Optimistic concurrency (AgentDefinition PATCH)

`PATCH /api/v1/agent-definitions/:id` requires `If-Match: <current_version>`; mismatch → 409 `VERSION_CONFLICT`. The SDK makes the version argument mandatory:

```ts
const {
  data: updated,
} = await client.agentDefinitions.patch(
  definition.id,
  definition.currentVersion, // If-Match
  { maxSteps: 100 }
);
```

## Event streaming

`client.streamEvents()` is an async generator over `{ id, data }` pairs where `id` is the monotonic per-run `run_events.seq` and `data` is one of:

- AI SDK 6 `UIMessageChunk` — `text-start`, `text-delta`, `text-end`, `reasoning-*`, `tool-*`, `start`, `finish`, `error`, step markers
- Open-rush extension — `data-openrush-run-started`, `data-openrush-run-done`, `data-openrush-usage`, `data-openrush-sub-run`
- Generic `data-<key>` with opaque payload

### Reconnection

On unexpected EOF (connection dropped mid-run before `data-openrush-run-done`), the SDK automatically reconnects with `Last-Event-ID: <last seen seq>`. Default back-off: 500 ms → 1 s → 2 s → 4 s → 8 s over 5 attempts. Customise via `onReconnect`:

```ts
for await (const ev of client.streamEvents({
  agentId,
  runId,
  lastEventId: 0, // resume from N if you've seen up to N
  onReconnect: ({ attempt, lastEventId, cause }) => {
    if (attempt > 3) return false; // give up
    return 2000; // ms to wait before reconnecting
  },
})) {
  /* ... */
}
```

`onReconnect` is consulted on two situations:

- **Unexpected EOF** — `cause` is the string `'eof'`. Returning `false` terminates the iterator gracefully (no throw).
- **Fetch / HTTP error** — `cause` is the underlying `Error`. Returning `false` rethrows so the caller can observe the failure.

Resuming with a `lastEventId` equal to the last seq of an already-terminated run EOFs with zero new events and exits **without** calling `onReconnect` — the server already drained everything.

### Cancellation

Pass an `AbortSignal`:

```ts
const ctrl = new AbortController();
setTimeout(() => ctrl.abort(), 30_000);
for await (const ev of client.streamEvents({
  agentId,
  runId,
  signal: ctrl.signal,
})) {
  /* ... */
}
```

## Error handling

Every non-2xx response throws `OpenRushApiError` carrying the server's stable envelope:

```ts
import { OpenRushApiError } from '@open-rush/sdk';

try {
  await client.agentDefinitions.patch(id, 1, { name: 'new' });
} catch (err) {
  if (err instanceof OpenRushApiError) {
    switch (err.code) {
      case 'VERSION_CONFLICT':
        // refetch + retry
        break;
      case 'VALIDATION_ERROR':
        console.error(err.issues);
        break;
      default:
        throw err;
    }
  } else {
    throw err;
  }
}
```

Stable `err.code` values (8 total): `UNAUTHORIZED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `VALIDATION_ERROR` (400), `VERSION_CONFLICT` (409), `IDEMPOTENCY_CONFLICT` (409), `RATE_LIMITED` (429), `INTERNAL` (500).

## Custom fetch

The SDK accepts a `fetch` option for Node < 18, tests, or custom agents (e.g. proxying, telemetry):

```ts
import nodeFetch from 'node-fetch';

const client = new OpenRushClient({
  baseUrl,
  token,
  fetch: nodeFetch as unknown as typeof fetch,
});
```

## License

MIT.
