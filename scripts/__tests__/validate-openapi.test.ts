/**
 * Tests for scripts/validate-openapi.ts — the contract-completeness guard
 * for docs/specs/openapi-v0.1.yaml.
 *
 * Two complementary goals:
 *
 *   1. **Smoke**: the real spec at `docs/specs/openapi-v0.1.yaml` passes
 *      every check. This catches regressions where someone deletes a
 *      path or renames a schema without updating the YAML.
 *
 *   2. **Negative**: each individual check function rejects the specific
 *      kind of drift it's there to catch (missing endpoint, missing
 *      scope, missing error code, broken $ref, wrong SSE content type).
 *      Without these we wouldn't know if the checker actually fails on
 *      bad input — a validator that silently passes everything is worse
 *      than no validator.
 *
 * We operate on parsed JSON objects rather than round-tripping through
 * YAML text; the parser is `yaml` and is already well tested upstream.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

import {
  checkContractInvariants,
  checkEndpoints,
  checkErrorCodes,
  checkReferences,
  checkScopes,
  checkSseContentType,
  checkStructure,
  type Json,
  REQUIRED_ENDPOINTS,
  REQUIRED_ERROR_CODES,
  REQUIRED_SCOPES,
  validateSpec,
} from '../validate-openapi.ts';

const scriptDir = resolve(fileURLToPath(import.meta.url), '..', '..');
const SPEC_PATH = resolve(scriptDir, '..', 'docs/specs/openapi-v0.1.yaml');

function loadRealSpec(): { [k: string]: Json } {
  return parseYaml(readFileSync(SPEC_PATH, 'utf8')) as { [k: string]: Json };
}

// A compact well-formed spec fixture used by the negative tests below.
// It satisfies every check; individual tests mutate it to simulate one
// drift at a time.
function goodSpec(): { [k: string]: Json } {
  const mkOp = (): Json => ({
    responses: { '200': { description: 'ok' } },
  });
  const paths: { [k: string]: Json } = {};
  for (const { path, op } of REQUIRED_ENDPOINTS) {
    const existing = (paths[path] as { [k: string]: Json } | undefined) ?? {};
    existing[op] = mkOp();
    paths[path] = existing;
  }
  // Attach the contract-invariant headers so `checkContractInvariants`
  // is satisfied by the fixture. Tests then mutate individual ops to
  // exercise negative paths.
  const patchDef = paths['/api/v1/agent-definitions/{id}'] as { [k: string]: Json };
  patchDef.patch = {
    parameters: [{ name: 'If-Match', in: 'header', required: true, schema: { type: 'integer' } }],
    responses: { '200': { description: 'ok' } },
  };
  const postRuns = paths['/api/v1/agents/{agentId}/runs'] as { [k: string]: Json };
  postRuns.post = {
    parameters: [
      { name: 'Idempotency-Key', in: 'header', required: false, schema: { type: 'string' } },
    ],
    responses: { '201': { description: 'created' } },
  };
  // SSE endpoint must have text/event-stream content on 200 + Last-Event-ID
  // header parameter.
  paths['/api/v1/agents/{agentId}/runs/{runId}/events'] = {
    get: {
      parameters: [
        { name: 'Last-Event-ID', in: 'header', required: false, schema: { type: 'integer' } },
      ],
      responses: {
        '200': {
          description: 'sse',
          content: { 'text/event-stream': { schema: { type: 'string' } } },
        },
      },
    },
  };
  return {
    openapi: '3.0.3',
    info: { title: 'x', version: '0.1.0' },
    paths,
    components: {
      schemas: {
        ErrorCode: { type: 'string', enum: [...REQUIRED_ERROR_CODES] },
        ServiceTokenScope: { type: 'string', enum: [...REQUIRED_SCOPES] },
      },
    },
  };
}

describe('validate-openapi — real spec smoke', () => {
  it('passes every check against docs/specs/openapi-v0.1.yaml', () => {
    const spec = loadRealSpec();
    const report = validateSpec(spec);
    expect(report.failures).toEqual([]);
    expect(report.counts.endpoints).toBe(REQUIRED_ENDPOINTS.length);
    // Spec has many $ref targets — we don't assert an exact count here
    // because it would be a change-detector. The individual $ref
    // resolution is asserted by `checkReferences` returning no errors.
    expect(report.counts.refs).toBeGreaterThan(0);
  });

  it('enumerates 26 required operations (Auth 3 + AgentDefinition 6 + Agent 4 + Run 5 + Vault 3 + Registry 2 + Project 3)', () => {
    // Guard-rail: keep the inventory aligned with `specs/managed-agents-api.md`
    // §Endpoint 清单. If a future contributor adds or removes an endpoint
    // they must also update REQUIRED_ENDPOINTS here — otherwise the
    // validator lies about "completeness".
    //
    // The 5 Run operations include the SSE events GET; the SSE
    // content-type check asserts its shape separately.
    expect(REQUIRED_ENDPOINTS).toHaveLength(26);
  });
});

describe('checkStructure', () => {
  it('accepts a well-formed 3.0.x root', () => {
    expect(checkStructure(goodSpec())).toEqual([]);
  });

  it('rejects missing openapi version', () => {
    const spec = goodSpec();
    delete (spec as Record<string, Json>).openapi;
    expect(checkStructure(spec).join('\n')).toMatch(/openapi version/);
  });

  it('rejects 2.x swagger', () => {
    const spec = goodSpec();
    spec.openapi = '2.0';
    expect(checkStructure(spec).join('\n')).toMatch(/openapi version/);
  });

  it('rejects missing info', () => {
    const spec = goodSpec();
    delete (spec as Record<string, Json>).info;
    expect(checkStructure(spec).join('\n')).toMatch(/info/);
  });
});

describe('checkEndpoints', () => {
  it('detects a missing path', () => {
    const spec = goodSpec();
    delete (spec.paths as Record<string, Json>)['/api/v1/auth/tokens'];
    const errs = checkEndpoints(spec);
    // Both POST and GET on /api/v1/auth/tokens should be reported.
    expect(errs.join('\n')).toMatch(/\/api\/v1\/auth\/tokens/);
  });

  it('detects a missing method on an existing path', () => {
    const spec = goodSpec();
    const paths = spec.paths as Record<string, Record<string, Json>>;
    delete paths['/api/v1/agents'].post;
    const errs = checkEndpoints(spec);
    expect(errs).toContain('paths: "/api/v1/agents" missing "POST" operation');
  });

  it('passes when all required endpoints are present', () => {
    expect(checkEndpoints(goodSpec())).toEqual([]);
  });
});

describe('checkErrorCodes', () => {
  it('passes when all 8 codes are present', () => {
    expect(checkErrorCodes(goodSpec())).toEqual([]);
  });

  it('detects a missing code', () => {
    const spec = goodSpec();
    (spec.components as { schemas: { ErrorCode: { enum: string[] } } }).schemas.ErrorCode.enum = [
      'UNAUTHORIZED',
      'FORBIDDEN',
      'NOT_FOUND',
    ];
    const errs = checkErrorCodes(spec);
    expect(errs).toContain('ErrorCode.enum missing "VALIDATION_ERROR"');
    expect(errs).toContain('ErrorCode.enum missing "IDEMPOTENCY_CONFLICT"');
  });

  it('detects a missing enum altogether', () => {
    const spec = goodSpec();
    delete (spec.components as { schemas: Record<string, Json> }).schemas.ErrorCode;
    const errs = checkErrorCodes(spec);
    expect(errs[0]).toMatch(/ErrorCode\.enum/);
  });

  it('rejects unexpected (extra) enum values — strict check', () => {
    const spec = goodSpec();
    (spec.components as { schemas: { ErrorCode: { enum: string[] } } }).schemas.ErrorCode.enum = [
      ...REQUIRED_ERROR_CODES,
      'MYSTERY_CODE',
    ];
    const errs = checkErrorCodes(spec);
    expect(errs).toContain('ErrorCode.enum has unexpected value "MYSTERY_CODE"');
  });
});

describe('checkScopes', () => {
  it('passes when all 11 scopes are present', () => {
    expect(checkScopes(goodSpec())).toEqual([]);
  });

  it('detects a missing scope', () => {
    const spec = goodSpec();
    (
      spec.components as { schemas: { ServiceTokenScope: { enum: string[] } } }
    ).schemas.ServiceTokenScope.enum = ['agents:read', 'agents:write'];
    const errs = checkScopes(spec);
    expect(errs).toContain('ServiceTokenScope.enum missing "runs:read"');
    expect(errs).toContain('ServiceTokenScope.enum missing "vaults:write"');
  });

  it("does NOT allow '*' as a required scope (session-only wildcard)", () => {
    // Sanity — the canonical scope list shouldn't accidentally include '*'.
    // '*' is session-only per specs/service-token-auth.md.
    expect(REQUIRED_SCOPES as readonly string[]).not.toContain('*');
  });

  it("rejects '*' appearing in the Service Token scope enum (strict)", () => {
    const spec = goodSpec();
    (
      spec.components as { schemas: { ServiceTokenScope: { enum: string[] } } }
    ).schemas.ServiceTokenScope.enum = [...REQUIRED_SCOPES, '*'];
    const errs = checkScopes(spec);
    expect(errs).toContain('ServiceTokenScope.enum has unexpected value "*"');
  });

  it('rejects unknown scope strings (strict)', () => {
    const spec = goodSpec();
    (
      spec.components as { schemas: { ServiceTokenScope: { enum: string[] } } }
    ).schemas.ServiceTokenScope.enum = [...REQUIRED_SCOPES, 'wallets:read'];
    const errs = checkScopes(spec);
    expect(errs).toContain('ServiceTokenScope.enum has unexpected value "wallets:read"');
  });
});

describe('checkSseContentType', () => {
  it('passes when /events advertises text/event-stream on 200', () => {
    expect(checkSseContentType(goodSpec())).toEqual([]);
  });

  it('fails when the content map is missing', () => {
    const spec = goodSpec();
    const paths = spec.paths as Record<string, Record<string, Json>>;
    paths['/api/v1/agents/{agentId}/runs/{runId}/events'] = {
      get: { responses: { '200': { description: 'sse' } } },
    };
    expect(checkSseContentType(spec)[0]).toMatch(/content missing/);
  });

  it('fails when content is present but not text/event-stream', () => {
    const spec = goodSpec();
    const paths = spec.paths as Record<string, Record<string, Json>>;
    paths['/api/v1/agents/{agentId}/runs/{runId}/events'] = {
      get: {
        responses: {
          '200': {
            description: 'wrong',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
        },
      },
    };
    expect(checkSseContentType(spec)[0]).toMatch(/text\/event-stream/);
  });
});

describe('checkContractInvariants', () => {
  it('passes on a fully-wired fixture', () => {
    expect(checkContractInvariants(goodSpec())).toEqual([]);
  });

  it('flags PATCH /agent-definitions/{id} missing If-Match header', () => {
    const spec = goodSpec();
    const paths = spec.paths as Record<string, Record<string, Json>>;
    paths['/api/v1/agent-definitions/{id}'].patch = {
      responses: { '200': { description: 'ok' } },
    };
    const errs = checkContractInvariants(spec);
    expect(errs.join('\n')).toMatch(/If-Match/);
  });

  it('flags PATCH /agent-definitions/{id} If-Match present but not required', () => {
    const spec = goodSpec();
    const paths = spec.paths as Record<string, Record<string, Json>>;
    paths['/api/v1/agent-definitions/{id}'].patch = {
      parameters: [
        { name: 'If-Match', in: 'header', required: false, schema: { type: 'integer' } },
      ],
      responses: { '200': { description: 'ok' } },
    };
    const errs = checkContractInvariants(spec);
    expect(errs).toContain('PATCH /api/v1/agent-definitions/{id}: If-Match must be required');
  });

  it('flags POST /runs missing Idempotency-Key parameter', () => {
    const spec = goodSpec();
    const paths = spec.paths as Record<string, Record<string, Json>>;
    paths['/api/v1/agents/{agentId}/runs'].post = {
      responses: { '201': { description: 'ok' } },
    };
    const errs = checkContractInvariants(spec);
    expect(errs.join('\n')).toMatch(/Idempotency-Key/);
  });

  it('flags POST /runs Idempotency-Key accidentally declared as required=true', () => {
    // If someone flips Idempotency-Key to required: true, the 24h dedup
    // semantics collapse (every call becomes dedup-scoped, clients can't
    // request a brand-new run). Assert we catch that drift.
    const spec = goodSpec();
    const paths = spec.paths as Record<string, Record<string, Json>>;
    paths['/api/v1/agents/{agentId}/runs'].post = {
      parameters: [
        { name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string' } },
      ],
      responses: { '201': { description: 'ok' } },
    };
    const errs = checkContractInvariants(spec);
    expect(errs).toContain(
      'POST /api/v1/agents/{agentId}/runs: Idempotency-Key must be optional (required !== true)'
    );
  });

  it('flags Idempotency-Key leaking onto another POST endpoint', () => {
    const spec = goodSpec();
    const paths = spec.paths as Record<string, Record<string, Json>>;
    paths['/api/v1/agents'].post = {
      parameters: [
        { name: 'Idempotency-Key', in: 'header', required: false, schema: { type: 'string' } },
      ],
      responses: { '201': { description: 'ok' } },
    };
    const errs = checkContractInvariants(spec);
    expect(errs).toContain('POST /api/v1/agents: Idempotency-Key only valid on POST /runs in v0.1');
  });

  it('flags GET /events missing Last-Event-ID parameter', () => {
    const spec = goodSpec();
    const paths = spec.paths as Record<string, Record<string, Json>>;
    paths['/api/v1/agents/{agentId}/runs/{runId}/events'] = {
      get: {
        responses: {
          '200': {
            description: 'sse',
            content: { 'text/event-stream': { schema: { type: 'string' } } },
          },
        },
      },
    };
    const errs = checkContractInvariants(spec);
    expect(errs.join('\n')).toMatch(/Last-Event-ID/);
  });

  it('resolves $ref parameters transparently', () => {
    // Same fixture, but the If-Match parameter is moved behind a $ref —
    // mimicking what the real spec does.
    const spec = goodSpec();
    (spec.components as { parameters?: Record<string, Json> }).parameters = {
      IfMatchHeader: {
        name: 'If-Match',
        in: 'header',
        required: true,
        schema: { type: 'integer' },
      },
    };
    const paths = spec.paths as Record<string, Record<string, Json>>;
    paths['/api/v1/agent-definitions/{id}'].patch = {
      parameters: [{ $ref: '#/components/parameters/IfMatchHeader' }],
      responses: { '200': { description: 'ok' } },
    };
    expect(checkContractInvariants(spec)).toEqual([]);
  });
});

describe('checkReferences', () => {
  it('passes when no $ref is used', () => {
    expect(checkReferences(goodSpec())).toEqual([]);
  });

  it('passes when $refs resolve', () => {
    const spec: { [k: string]: Json } = {
      components: {
        schemas: {
          Foo: { type: 'object' },
        },
      },
      paths: {
        '/x': {
          get: {
            responses: {
              '200': {
                description: 'ok',
                content: {
                  'application/json': { schema: { $ref: '#/components/schemas/Foo' } },
                },
              },
            },
          },
        },
      },
    };
    expect(checkReferences(spec)).toEqual([]);
  });

  it('flags a broken $ref', () => {
    const spec: { [k: string]: Json } = {
      components: { schemas: { Foo: { type: 'object' } } },
      paths: {
        '/x': {
          get: {
            responses: {
              '200': {
                description: 'ok',
                content: {
                  'application/json': { schema: { $ref: '#/components/schemas/MissingBar' } },
                },
              },
            },
          },
        },
      },
    };
    const errs = checkReferences(spec);
    expect(errs).toEqual(['unresolved $ref: #/components/schemas/MissingBar']);
  });

  it('ignores external $refs (remote spec composition)', () => {
    const spec: { [k: string]: Json } = {
      paths: {
        '/x': {
          get: {
            responses: {
              '200': {
                description: 'ok',
                content: {
                  'application/json': { schema: { $ref: 'https://example.com/schema.json#/Bar' } },
                },
              },
            },
          },
        },
      },
    };
    expect(checkReferences(spec)).toEqual([]);
  });
});

describe('validateSpec', () => {
  it('aggregates failures from all checks', () => {
    const spec = goodSpec();
    // Introduce multiple independent drifts at once.
    delete (spec.paths as Record<string, Json>)['/api/v1/skills'];
    const ec = spec.components as { schemas: { ErrorCode: { enum: string[] } } };
    ec.schemas.ErrorCode.enum = ['UNAUTHORIZED'];
    const { failures } = validateSpec(spec);
    // At least one failure from each mutated area.
    expect(failures.some((f) => f.includes('/api/v1/skills'))).toBe(true);
    expect(failures.some((f) => f.includes('ErrorCode.enum missing'))).toBe(true);
  });
});
