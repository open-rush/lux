# agent-c-api progress

Track: M4 API-docs chain (task-15 OpenAPI + task-16 TypeScript SDK).

## task-15 — OpenAPI v0.1 spec + validate script

- **Branch**: `feat/task-15` (worktree `/tmp/agent-wt/c1`, based on main `4ff1783`)
- **Files delivered**
  - `docs/specs/openapi-v0.1.yaml` — 3.0.3 spec, 26 REST operations + 1 SSE
    operation, full request / response / error schemas; auth schemes cover
    Service Token bearer + NextAuth session cookie.
  - `scripts/validate-openapi.ts` — exports pure check functions + CLI
    runner (loads YAML, asserts structure / endpoints / error codes /
    scopes / SSE content-type / `$ref` integrity).
  - `scripts/__tests__/validate-openapi.test.ts` — 23 vitest cases:
    smoke against the real spec + negative coverage on every check.
  - `scripts/package.json` + `scripts/tsconfig.json` + `scripts/vitest.config.ts`
    — new workspace package `@open-rush/scripts` (added to
    `pnpm-workspace.yaml`) so the test runs under the standard `pnpm test`
    pipeline.
  - `package.json` — new `validate:openapi` script (uses
    `node --experimental-strip-types`, no extra loader); added `tsx` +
    `yaml` root devDeps (root uses `pnpm tsx` via verify.sh).
  - `.github/workflows/ci.yml` — added `pnpm validate:openapi` between
    `check` and `test`.

- **Design decisions**
  - Scope count: stuck with the 11 Service Token scopes already encoded in
    `packages/contracts/src/v1/common.ts` `ServiceTokenScope` (authoritative).
    `'*'` stays session-only per spec §颁发流程 and is excluded from the
    OpenAPI enum.
  - Endpoint count: **26 REST** (spec prose says "24" but the full set =
    auth 3 + agent-definitions 6 + agents 4 + runs 5 + vaults 3 + registry 2
    + projects 3 = 26). Validator asserts all 26 so the prose vs. contract
    drift is caught automatically. Added a test case that pins the count to
    avoid silent drift.
  - Event payload: modelled as `oneOf` over every AI SDK 6 UIMessageChunk
    variant (`text-*`, `reasoning-*`, `tool-*`, `start` / `finish` / `error`,
    step markers) + 4 Open-rush extensions (`data-openrush-run-started` /
    `-run-done` / `-usage` / `-sub-run`) + a generic
    `data-(?!openrush-)[A-Za-z0-9_-]+` escape hatch. Mirrors
    `runEventPayloadSchema` in `packages/contracts/src/v1/runs.ts` 1:1.
  - SSE: `/events` GET 200 advertises `text/event-stream`; validator
    asserts this. Documented the `id: <seq>\ndata: <json>\n\n` frame shape
    with examples for text-delta / tool-input-available / run-done.
  - Spec renders cleanly in Swagger UI / Redoc (tested via visual
    inspection of `yaml.parse` structure). All 76 internal `$ref` targets
    resolve per `checkReferences`.
  - Validator refactor: split pure check functions from CLI runner so
    vitest can drive them with synthetic inputs (negative tests) without
    touching process.exit / console. CLI runner only fires when
    `isMainModule()` returns true.

- **Green**: `pnpm build && pnpm check && pnpm lint && pnpm test` all pass
  (32 → 33 workspace tasks, 397+34 tests). `./docs/execution/verify.sh
  task-15` ends with `[PASS] task-15`.

- **Sparring rounds** (Codex `gpt-5.3-codex-xhigh`):
  - R1: CONCERNS — 3 MUST-FIX (`TokenListItem` required fields, drop
    `info.summary` for OAS 3.0, strict enum comparison) + 1 SHOULD-FIX
    (additional contract invariants).
  - R2: CONCERNS — 1 MUST-FIX (assert Idempotency-Key MUST be
    `required: false`, not just present).
  - R3: APPROVE.

- **Next**: commit + PR (Closes #130), hand off to task-16.

## task-16 — TypeScript SDK `@open-rush/sdk`

- **Branch**: `feat/task-16` (worktree `/tmp/agent-wt/c1`, off `feat/task-15`;
  rebases onto main once #158 merges).
- **Files delivered** (new package):
  - `packages/sdk/package.json` — workspace dep on `@open-rush/contracts`,
    dual ESM+CJS output via tsup, vitest test runner.
  - `packages/sdk/src/index.ts` — barrel re-exports `OpenRushClient`,
    `OpenRushApiError`, SSE helpers, and the `v1` namespace.
  - `packages/sdk/src/http.ts` — `performRequest` / `performStreamRequest`
    (thin transport: Bearer token, JSON envelope, 204 handling, error
    envelope parsing). No retry, no caching, no pagination helper.
  - `packages/sdk/src/errors.ts` — `OpenRushApiError` with stable `code`
    discriminant (8 values from contracts v1).
  - `packages/sdk/src/sse.ts` — `streamEvents` async generator with
    `Last-Event-ID` reconnect + configurable back-off + abort support.
    Mirrors task-14 server semantics (spec §断线重连). Zero runtime
    dependency (pure `fetch` + `ReadableStream` + `TextDecoder`).
  - `packages/sdk/src/client.ts` — `OpenRushClient` with 8 resource
    namespaces (`authTokens`, `agentDefinitions`, `agents`, `runs`,
    `vaults`, `skills`, `mcps`, `projects`) + top-level `streamEvents`.
    All types pulled from `@open-rush/contracts` via `Partial<>` wrappers
    for defaulted query schemas (limit/includeArchived).
  - `packages/sdk/src/__tests__/http.test.ts` — 19 vitest cases (URL
    build, headers, body serialization, 204, defaults merge, abort,
    error envelope parsing, stream transport, global fetch fallback).
  - `packages/sdk/src/__tests__/client.test.ts` — 22 cases covering
    every resource method's HTTP method / path / headers / body. Asserts
    `If-Match` on PATCH definitions, optional `Idempotency-Key` on
    `runs.create`, Authorization bypass when no token.
  - `packages/sdk/src/__tests__/sse.test.ts` — 20 cases: `parseSseFrame`
    happy + malformed, terminal run EOF after `data-openrush-run-done`,
    reconnect with `Last-Event-ID`, policy returning false, client-side
    dedup of `seq <= lastEventId`, abort mid-stream.
  - `packages/sdk/README.md` — quickstart + API reference + idempotency
    / concurrency / reconnect / errors sections.

- **Design decisions**
  - Thin HTTP client, **no codegen from OpenAPI**. Contracts are the
    single source of truth; OpenAPI is a derived artefact. Generating
    from YAML would introduce silent drift if somebody edits contracts
    without regenerating.
  - **No runtime Zod validation on hot path** — re-validating every SSE
    frame would cost 1-2 ms/frame. Server is the single writer and has
    its own invariants; the SDK simply `as`-casts to `v1.RunEventPayload`.
    Callers wanting validation can `v1.runEventPayloadSchema.parse(ev.data)`.
  - **Optimistic-concurrency discipline**: `agentDefinitions.patch()`
    takes `ifMatchVersion` as a **positional** argument (not optional),
    making it impossible to forget the `If-Match` header.
  - **Idempotency-Key as an explicit option object** — `runs.create(agentId,
    body, { idempotencyKey })`. Separates it from body schema (contract)
    and makes it visible in IDE autocomplete.
  - **Partial<Query> for list methods** — contracts' `paginationQuerySchema`
    has `limit: z.coerce.number().default(50)` which infers `limit: number`
    (required in output type). Using `Partial<>` on the SDK surface lets
    callers call `list()` with zero args.
  - **Custom fetch injection** — `fetch?: FetchLike` in
    `OpenRushClientOptions`. Tests use it exclusively (no global stubbing);
    Node < 18 users can pass node-fetch.
  - **streamEvents is an AsyncGenerator** — matches `for-await-of`
    ergonomics; abort is supported via `AbortSignal`; reconnect policy is
    caller-overridable.

- **Green**: `pnpm build && pnpm check && pnpm lint && pnpm test` all
  pass (35 workspace tasks, 62 SDK tests).
  `./docs/execution/verify.sh task-16` → `[PASS]`.

- **Sparring rounds** (Codex `gpt-5.3-codex-xhigh`):
  - R1: CONCERNS — 1 MUST-FIX + 2 SHOULD-FIX.
    - MUST-FIX: `streamEvents()` could enter a ~15 s reconnect back-off
      chain when a caller resumed with `lastEventId = <last seq>` of an
      already-terminal run (server drains nothing, closes — SDK misread
      EOF as "mid-run disconnect"). Fixed by treating zero-event EOF as
      terminal exit (matches task-14 `initialIsTerminal` branch).
    - SHOULD-FIX: README same-origin example had `baseUrl: ''` which
      throws at construct time — switched to `window.location.origin`.
    - SHOULD-FIX: `onReconnect` returning `false` had asymmetric
      semantics (EOF = graceful exit, error = rethrow). Documented the
      distinction in JSDoc + README.
  - R2: APPROVE (no regressions; zero-event-EOF rule noted as a
    server-contract assumption that task-18 E2E implicitly guards).

- **Next**: commit + PR (Closes #131). SDK branch is based on
  `feat/task-15`; once #158 merges, rebase onto main.
