/**
 * OpenAPI v0.1 spec validator.
 *
 * Runs two layers of checks:
 *
 *  1. **YAML / OpenAPI structural validity** — the file parses as YAML and
 *     has the required top-level shape (`openapi` 3.0.x, `info`, `paths`,
 *     `components`). We stay lightweight here (no Ajv / swagger-parser):
 *     the goal is to catch the YAML typos and schema-rename regressions
 *     that a human reviewer most easily misses.
 *
 *  2. **Contract completeness** — every endpoint we promised in
 *     `specs/managed-agents-api.md` (26 total; one of them — `GET
 *     /events` — is an SSE stream) is actually present; all 8 error
 *     codes appear in `components.schemas.ErrorCode.enum`; all 11
 *     Service Token scopes appear in
 *     `components.schemas.ServiceTokenScope.enum`; the SSE endpoint's
 *     `200` response carries `text/event-stream`; contract headers
 *     (`If-Match`, `Idempotency-Key`, `Last-Event-ID`) land on the
 *     right operations; every `$ref` resolves.
 *
 * Invoke via `pnpm validate:openapi` (or `pnpm tsx scripts/validate-openapi.ts`).
 *
 * Exit codes:
 *   0 — spec is valid and complete
 *   1 — any check failed (detailed reasons printed)
 *
 * The checks below are also exported so vitest can drive them against
 * synthetic specs — see `scripts/__tests__/validate-openapi.test.ts`.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

// -----------------------------------------------------------------------------
// Types + pure check functions (exported for tests)
// -----------------------------------------------------------------------------

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export type Method = 'get' | 'post' | 'patch' | 'delete';

export interface EndpointSpec {
  path: string;
  op: Method;
}

/**
 * Canonical endpoint inventory. Keep this list aligned with
 * `specs/managed-agents-api.md` §Endpoint 清单 whenever new endpoints land.
 *
 * 26 operations in total — one of them (`GET /events`) is the SSE stream,
 * which the `checkSseContentType` pass verifies separately. The spec
 * prose occasionally says "24" — that predates the Project + Registry
 * additions; the Zod contracts in `packages/contracts/src/v1/*.ts` are
 * the source of truth and cover all 26.
 */
export const REQUIRED_ENDPOINTS: EndpointSpec[] = [
  // Auth (3)
  { path: '/api/v1/auth/tokens', op: 'post' },
  { path: '/api/v1/auth/tokens', op: 'get' },
  { path: '/api/v1/auth/tokens/{id}', op: 'delete' },
  // AgentDefinition (6)
  { path: '/api/v1/agent-definitions', op: 'post' },
  { path: '/api/v1/agent-definitions', op: 'get' },
  { path: '/api/v1/agent-definitions/{id}', op: 'get' },
  { path: '/api/v1/agent-definitions/{id}', op: 'patch' },
  { path: '/api/v1/agent-definitions/{id}/versions', op: 'get' },
  { path: '/api/v1/agent-definitions/{id}/archive', op: 'post' },
  // Agent (4)
  { path: '/api/v1/agents', op: 'post' },
  { path: '/api/v1/agents', op: 'get' },
  { path: '/api/v1/agents/{id}', op: 'get' },
  { path: '/api/v1/agents/{id}', op: 'delete' },
  // Run (5)
  { path: '/api/v1/agents/{agentId}/runs', op: 'post' },
  { path: '/api/v1/agents/{agentId}/runs', op: 'get' },
  { path: '/api/v1/agents/{agentId}/runs/{runId}', op: 'get' },
  { path: '/api/v1/agents/{agentId}/runs/{runId}/cancel', op: 'post' },
  { path: '/api/v1/agents/{agentId}/runs/{runId}/events', op: 'get' },
  // Vault (3)
  { path: '/api/v1/vaults/entries', op: 'post' },
  { path: '/api/v1/vaults/entries', op: 'get' },
  { path: '/api/v1/vaults/entries/{id}', op: 'delete' },
  // Registry (2)
  { path: '/api/v1/skills', op: 'get' },
  { path: '/api/v1/mcps', op: 'get' },
  // Project (3)
  { path: '/api/v1/projects', op: 'post' },
  { path: '/api/v1/projects', op: 'get' },
  { path: '/api/v1/projects/{id}', op: 'get' },
];

/** All 8 error codes from `packages/contracts/src/v1/common.ts` `ErrorCode`. */
export const REQUIRED_ERROR_CODES = [
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'VALIDATION_ERROR',
  'VERSION_CONFLICT',
  'IDEMPOTENCY_CONFLICT',
  'RATE_LIMITED',
  'INTERNAL',
] as const;

/**
 * All 11 Service Token scopes from `packages/contracts/src/v1/common.ts`
 * `ServiceTokenScope`. The `'*'` wildcard is intentionally excluded — it
 * is session-only and explicitly rejected by the Service Token create
 * endpoint.
 */
export const REQUIRED_SCOPES = [
  'agent-definitions:read',
  'agent-definitions:write',
  'agents:read',
  'agents:write',
  'runs:read',
  'runs:write',
  'runs:cancel',
  'vaults:read',
  'vaults:write',
  'projects:read',
  'projects:write',
] as const;

/** Narrow a JSON value to an object (record) or return undefined. */
function asObject(v: Json | undefined): { [k: string]: Json } | undefined {
  if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
    return v;
  }
  return undefined;
}

/**
 * Top-level structural sanity: `openapi` version ~ 3.0.x, `info` has
 * title + version, `paths` + `components` are objects.
 */
export function checkStructure(spec: { [k: string]: Json }): string[] {
  const errs: string[] = [];
  const openapi = spec.openapi;
  if (typeof openapi !== 'string' || !/^3\.0\.\d+$/.test(openapi)) {
    errs.push(`openapi version missing / not 3.0.x (got ${String(openapi)})`);
  }
  const info = asObject(spec.info);
  if (!info) errs.push('info: missing');
  else if (typeof info.title !== 'string' || typeof info.version !== 'string') {
    errs.push('info.title / info.version missing');
  }
  if (!asObject(spec.paths)) errs.push('paths: missing');
  if (!asObject(spec.components)) errs.push('components: missing');
  return errs;
}

/** Every required (path, method) pair exists in `paths`. */
export function checkEndpoints(
  spec: { [k: string]: Json },
  required: EndpointSpec[] = REQUIRED_ENDPOINTS
): string[] {
  const errs: string[] = [];
  const paths = asObject(spec.paths);
  if (!paths) {
    errs.push('spec.paths is missing or not an object');
    return errs;
  }
  for (const { path, op } of required) {
    const pathItem = asObject(paths[path]);
    if (!pathItem) {
      errs.push(`paths: missing "${path}"`);
      continue;
    }
    if (!asObject(pathItem[op])) {
      errs.push(`paths: "${path}" missing "${op.toUpperCase()}" operation`);
    }
  }
  return errs;
}

/**
 * `ErrorCode` enum contains EXACTLY the required codes — no missing, no
 * extras. Extras catch the subtle regression where someone adds a code to
 * the OpenAPI spec without adding it to the Zod contract (or vice versa).
 */
export function checkErrorCodes(
  spec: { [k: string]: Json },
  required: readonly string[] = REQUIRED_ERROR_CODES
): string[] {
  const errs: string[] = [];
  const components = asObject(spec.components);
  const schemas = components ? asObject(components.schemas) : undefined;
  const errorCode = schemas ? asObject(schemas.ErrorCode) : undefined;
  const enumValues = errorCode?.enum;
  if (!Array.isArray(enumValues)) {
    errs.push('components.schemas.ErrorCode.enum missing / not an array');
    return errs;
  }
  const got = new Set(enumValues);
  for (const code of required) {
    if (!got.has(code)) errs.push(`ErrorCode.enum missing "${code}"`);
  }
  const allowed = new Set<string>(required);
  for (const v of enumValues) {
    if (typeof v !== 'string' || !allowed.has(v)) {
      errs.push(`ErrorCode.enum has unexpected value "${String(v)}"`);
    }
  }
  return errs;
}

/**
 * `ServiceTokenScope` enum contains EXACTLY the 11 required scopes — no
 * missing, no extras. In particular, the wildcard `'*'` is session-only
 * and MUST NOT appear in the Service-Token-facing enum (spec §颁发流程 +
 * §Scope 定义).
 */
export function checkScopes(
  spec: { [k: string]: Json },
  required: readonly string[] = REQUIRED_SCOPES
): string[] {
  const errs: string[] = [];
  const components = asObject(spec.components);
  const schemas = components ? asObject(components.schemas) : undefined;
  const scope = schemas ? asObject(schemas.ServiceTokenScope) : undefined;
  const enumValues = scope?.enum;
  if (!Array.isArray(enumValues)) {
    errs.push('components.schemas.ServiceTokenScope.enum missing / not an array');
    return errs;
  }
  const got = new Set(enumValues);
  for (const s of required) {
    if (!got.has(s)) errs.push(`ServiceTokenScope.enum missing "${s}"`);
  }
  const allowed = new Set<string>(required);
  for (const v of enumValues) {
    if (typeof v !== 'string' || !allowed.has(v)) {
      errs.push(`ServiceTokenScope.enum has unexpected value "${String(v)}"`);
    }
  }
  return errs;
}

/**
 * Hunt for a parameter named `name` on a given operation or path item.
 * Checks both the operation-level `parameters` array and the path-item
 * `parameters` array (OpenAPI 3.0 semantics).
 */
function findParameter(
  spec: { [k: string]: Json },
  pathKey: string,
  op: Method,
  name: string,
  loc: 'header' | 'path' | 'query' | 'cookie'
): { [k: string]: Json } | undefined {
  const paths = asObject(spec.paths);
  const pathItem = paths ? asObject(paths[pathKey]) : undefined;
  const operation = pathItem ? asObject(pathItem[op]) : undefined;

  const collect = (arr: Json | undefined): Array<{ [k: string]: Json }> => {
    if (!Array.isArray(arr)) return [];
    const out: Array<{ [k: string]: Json }> = [];
    for (const p of arr) {
      // `$ref` → resolve to `components.parameters.<name>`.
      const obj = asObject(p);
      if (obj && typeof obj.$ref === 'string' && obj.$ref.startsWith('#/components/parameters/')) {
        const key = obj.$ref.slice('#/components/parameters/'.length);
        const components = asObject(spec.components);
        const params = components ? asObject(components.parameters) : undefined;
        const resolved = params ? asObject(params[key]) : undefined;
        if (resolved) out.push(resolved);
      } else if (obj) {
        out.push(obj);
      }
    }
    return out;
  };

  const candidates = [...collect(pathItem?.parameters), ...collect(operation?.parameters)];
  return candidates.find(
    (p) => typeof p.name === 'string' && p.name.toLowerCase() === name.toLowerCase() && p.in === loc
  );
}

/**
 * Contract invariants beyond shape: the operations we care about must
 * expose the right request headers / params.
 *
 * v0.1 invariants (source: specs/managed-agents-api.md + contracts v1):
 *  - PATCH /api/v1/agent-definitions/{id} requires `If-Match` header
 *  - POST /api/v1/agents/{agentId}/runs accepts `Idempotency-Key` header
 *    (optional) — and this is the ONLY endpoint that does.
 *  - GET /api/v1/agents/{agentId}/runs/{runId}/events accepts
 *    `Last-Event-ID` header.
 *
 * We check these explicitly because the structural check can't catch a
 * silent header removal — `paths` would still look "complete".
 */
export function checkContractInvariants(spec: { [k: string]: Json }): string[] {
  const errs: string[] = [];

  // PATCH /agent-definitions/{id} — If-Match required
  const ifMatch = findParameter(
    spec,
    '/api/v1/agent-definitions/{id}',
    'patch',
    'If-Match',
    'header'
  );
  if (!ifMatch) {
    errs.push('PATCH /api/v1/agent-definitions/{id}: missing If-Match header parameter');
  } else if (ifMatch.required !== true) {
    errs.push('PATCH /api/v1/agent-definitions/{id}: If-Match must be required');
  }

  // POST /runs — Idempotency-Key (optional) present.
  //
  // v0.1 scope rule (spec §幂等性): clients MAY omit this header and still
  // get a create — omitting the header is how we tell "new run" from
  // "replay". If the spec ever flips this to `required: true`, SDKs will
  // break and the 24h de-dup window becomes meaningless. We therefore
  // assert BOTH presence AND optionality.
  const idempotency = findParameter(
    spec,
    '/api/v1/agents/{agentId}/runs',
    'post',
    'Idempotency-Key',
    'header'
  );
  if (!idempotency) {
    errs.push(
      'POST /api/v1/agents/{agentId}/runs: missing optional Idempotency-Key header parameter'
    );
  } else if (idempotency.required === true) {
    errs.push(
      'POST /api/v1/agents/{agentId}/runs: Idempotency-Key must be optional (required !== true)'
    );
  }

  // Idempotency-Key must NOT leak onto any other POST — v0.1 scope.
  const paths = asObject(spec.paths);
  if (paths) {
    for (const [pathKey, pathVal] of Object.entries(paths)) {
      if (pathKey === '/api/v1/agents/{agentId}/runs') continue;
      const pathItem = asObject(pathVal);
      if (!pathItem) continue;
      for (const op of ['post', 'patch', 'put', 'delete'] as const) {
        const maybe = pathItem[op];
        if (!asObject(maybe)) continue;
        const seen = findParameter(spec, pathKey, op as Method, 'Idempotency-Key', 'header');
        if (seen) {
          errs.push(
            `${op.toUpperCase()} ${pathKey}: Idempotency-Key only valid on POST /runs in v0.1`
          );
        }
      }
    }
  }

  // GET /events — Last-Event-ID header present (optional is fine).
  const lastEventId = findParameter(
    spec,
    '/api/v1/agents/{agentId}/runs/{runId}/events',
    'get',
    'Last-Event-ID',
    'header'
  );
  if (!lastEventId) {
    errs.push(
      'GET /api/v1/agents/{agentId}/runs/{runId}/events: missing Last-Event-ID header parameter'
    );
  }

  return errs;
}

/**
 * SSE endpoint must advertise `text/event-stream` on its 200 response —
 * otherwise Swagger UI / Postman won't offer the right consumer.
 */
export function checkSseContentType(spec: { [k: string]: Json }): string[] {
  const errs: string[] = [];
  const paths = asObject(spec.paths);
  const eventsPath = paths
    ? asObject(paths['/api/v1/agents/{agentId}/runs/{runId}/events'])
    : undefined;
  const getOp = eventsPath ? asObject(eventsPath.get) : undefined;
  const responses = getOp ? asObject(getOp.responses) : undefined;
  const two00 = responses ? asObject(responses['200']) : undefined;
  const content = two00 ? asObject(two00.content) : undefined;
  if (!content) {
    errs.push('SSE events endpoint: responses.200.content missing');
    return errs;
  }
  if (content['text/event-stream'] === undefined) {
    errs.push('SSE events endpoint: responses.200 must expose text/event-stream content type');
  }
  return errs;
}

/**
 * Every `#/components/...` internal `$ref` resolves to an actual node.
 * External refs (not starting with `#/`) are skipped — we assume the
 * reviewer checks those manually.
 */
export function checkReferences(spec: { [k: string]: Json }): string[] {
  const errs: string[] = [];
  const refs = new Set<string>();

  const visit = (node: Json): void => {
    if (node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    for (const [k, v] of Object.entries(node)) {
      if (k === '$ref' && typeof v === 'string') refs.add(v);
      else visit(v);
    }
  };
  visit(spec);

  const resolveRef = (ref: string): boolean => {
    if (!ref.startsWith('#/')) return true;
    const segs = ref.slice(2).split('/');
    let cur: unknown = spec;
    for (const seg of segs) {
      const decoded = seg.replace(/~1/g, '/').replace(/~0/g, '~');
      if (cur === null || typeof cur !== 'object' || !(decoded in (cur as object))) return false;
      cur = (cur as Record<string, unknown>)[decoded];
    }
    return cur !== undefined;
  };

  for (const ref of refs) {
    if (!resolveRef(ref)) errs.push(`unresolved $ref: ${ref}`);
  }
  return errs;
}

export interface ValidateReport {
  failures: string[];
  counts: {
    endpoints: number;
    refs: number;
  };
}

/**
 * End-to-end validation. Returns the concatenated failure list and some
 * counts useful for console output; never throws and never calls
 * `process.exit` — leave those to the runner (for testability).
 */
export function validateSpec(spec: { [k: string]: Json }): ValidateReport {
  const failures = [
    ...checkStructure(spec),
    ...checkEndpoints(spec),
    ...checkErrorCodes(spec),
    ...checkScopes(spec),
    ...checkSseContentType(spec),
    ...checkContractInvariants(spec),
    ...checkReferences(spec),
  ];

  // Count refs for the runner log line.
  let refCount = 0;
  const seen = new Set<string>();
  const visit = (node: Json): void => {
    if (node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    for (const [k, v] of Object.entries(node)) {
      if (k === '$ref' && typeof v === 'string' && !seen.has(v)) {
        seen.add(v);
        refCount += 1;
      } else visit(v);
    }
  };
  visit(spec);

  return { failures, counts: { endpoints: REQUIRED_ENDPOINTS.length, refs: refCount } };
}

/** Read + parse the YAML spec. Throws on IO / parse errors. */
export function loadSpec(path: string): Json {
  const src = readFileSync(path, 'utf8');
  return parseYaml(src) as Json;
}

// -----------------------------------------------------------------------------
// CLI runner
// -----------------------------------------------------------------------------

/**
 * Detect whether this module was invoked directly (as opposed to being
 * imported by a test). When node/tsx runs a TS entry file, `argv[1]` is
 * the script path; we compare it to `import.meta.url`.
 */
function isMainModule(): boolean {
  const scriptPath = process.argv[1];
  if (!scriptPath) return false;
  const entryUrl = new URL(`file://${resolve(scriptPath)}`).href;
  return import.meta.url === entryUrl;
}

function runCli(): void {
  // Repo root relative to this script. Works whether invoked from repo
  // root, a subpackage, or via `pnpm tsx`.
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const specPath = resolve(scriptDir, '..', 'docs/specs/openapi-v0.1.yaml');

  console.log(`Validating ${specPath}`);

  let spec: Json;
  try {
    spec = loadSpec(specPath);
  } catch (err) {
    console.error(`[validate-openapi] failed to load/parse ${specPath}`);
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const specObj = asObject(spec);
  if (!specObj) {
    console.error('[validate-openapi] spec root is not an object');
    process.exit(1);
  }

  const { failures, counts } = validateSpec(specObj);

  console.log(`  checked ${counts.endpoints} required operations`);
  console.log(`  checked ${counts.refs} unique $ref targets`);

  if (failures.length === 0) {
    console.log('PASS — OpenAPI spec is valid and complete.');
    process.exit(0);
  }
  console.error(`FAIL — ${failures.length} problem(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

if (isMainModule()) {
  runCli();
}
