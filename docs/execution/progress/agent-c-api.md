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

## task-16 — planned

- Implement after task-15 merges.
- Strategy: thin HTTP client in `packages/sdk`, re-export
  `@open-rush/contracts/v1` types (no codegen). SSE client mirrors the
  task-14 route: `EventSource`-like fetch loop with `Last-Event-ID`
  reconnect; expose `createAgent` / `createRun` / `streamEvents` etc.
