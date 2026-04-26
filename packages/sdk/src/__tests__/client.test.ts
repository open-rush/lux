/**
 * Tests for `client.ts` — the public resource-namespace surface.
 *
 * Strategy:
 *
 *   Every resource method maps 1:1 to an `/api/v1/*` operation listed in
 *   `specs/managed-agents-api.md`. The test body wires a fake fetch,
 *   invokes each method with a minimal body, and asserts:
 *     1. the request METHOD is correct (POST vs GET vs PATCH vs DELETE)
 *     2. the URL path matches the spec
 *     3. headers unique to that endpoint are attached (If-Match on
 *        definitions.patch, Idempotency-Key on runs.create, Authorization
 *        Bearer flows through)
 *     4. the returned value is the parsed response envelope.
 *
 *   We do NOT re-test JSON serialisation / error envelope parsing —
 *   those live in `http.test.ts`. The mock fetch here simply returns a
 *   canned success envelope for every call.
 */

import { describe, expect, it } from 'vitest';
import { OpenRushClient } from '../client.js';
import type { FetchLike } from '../http.js';

interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}

function makeClient(
  canned: Record<string, unknown> | ((req: CapturedRequest) => unknown) = { data: {} }
): {
  client: OpenRushClient;
  calls: CapturedRequest[];
} {
  const calls: CapturedRequest[] = [];
  const fetchImpl: FetchLike = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init.method ?? 'GET';
    const headers = { ...((init.headers ?? {}) as Record<string, string>) };
    const bodyStr = init.body;
    const body = typeof bodyStr === 'string' ? JSON.parse(bodyStr) : undefined;
    const req: CapturedRequest = { url, method, headers, body };
    calls.push(req);
    const payload = typeof canned === 'function' ? canned(req) : canned;
    return new Response(JSON.stringify(payload), {
      status: method === 'POST' ? 201 : 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  const client = new OpenRushClient({
    baseUrl: 'https://h.example.com',
    token: 'sk_test_abc',
    fetch: fetchImpl,
  });
  return { client, calls };
}

// ---------------------------------------------------------------------------
// Smoke
// ---------------------------------------------------------------------------

describe('OpenRushClient constructor', () => {
  it('requires baseUrl', () => {
    expect(
      () =>
        new OpenRushClient({ baseUrl: '' } as unknown as ConstructorParameters<
          typeof OpenRushClient
        >[0])
    ).toThrow(/baseUrl is required/);
  });

  it('exposes 8 resource namespaces', () => {
    const { client } = makeClient();
    expect(client.authTokens).toBeDefined();
    expect(client.agentDefinitions).toBeDefined();
    expect(client.agents).toBeDefined();
    expect(client.runs).toBeDefined();
    expect(client.vaults).toBeDefined();
    expect(client.skills).toBeDefined();
    expect(client.mcps).toBeDefined();
    expect(client.projects).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// AuthTokens (3)
// ---------------------------------------------------------------------------

describe('client.authTokens', () => {
  it('create → POST /api/v1/auth/tokens with body', async () => {
    const { client, calls } = makeClient();
    await client.authTokens.create({
      name: 't',
      scopes: ['agents:read'],
      expiresAt: '2099-01-01T00:00:00Z',
    });
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toBe('https://h.example.com/api/v1/auth/tokens');
    expect(calls[0].body).toEqual({
      name: 't',
      scopes: ['agents:read'],
      expiresAt: '2099-01-01T00:00:00Z',
    });
  });

  it('list → GET /api/v1/auth/tokens with pagination', async () => {
    const { client, calls } = makeClient();
    await client.authTokens.list({ limit: 10, cursor: 'abc' });
    expect(calls[0].method).toBe('GET');
    expect(calls[0].url).toContain('limit=10');
    expect(calls[0].url).toContain('cursor=abc');
  });

  it('delete → DELETE /api/v1/auth/tokens/:id', async () => {
    const { client, calls } = makeClient();
    await client.authTokens.delete('11111111-1111-1111-1111-111111111111');
    expect(calls[0].method).toBe('DELETE');
    expect(calls[0].url).toBe(
      'https://h.example.com/api/v1/auth/tokens/11111111-1111-1111-1111-111111111111'
    );
  });
});

// ---------------------------------------------------------------------------
// AgentDefinitions (6)
// ---------------------------------------------------------------------------

describe('client.agentDefinitions', () => {
  it('create → POST', async () => {
    const { client, calls } = makeClient();
    await client.agentDefinitions.create({
      projectId: 'p',
      name: 'demo',
      providerType: 'anthropic',
      allowedTools: [],
      skills: [],
      mcpServers: [],
      maxSteps: 100,
      deliveryMode: 'chat',
    });
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toBe('https://h.example.com/api/v1/agent-definitions');
  });

  it('list → GET with includeArchived as query', async () => {
    const { client, calls } = makeClient();
    await client.agentDefinitions.list({ includeArchived: true });
    expect(calls[0].method).toBe('GET');
    expect(calls[0].url).toContain('includeArchived=true');
  });

  it('get → GET :id with optional version', async () => {
    const { client, calls } = makeClient();
    await client.agentDefinitions.get('def-1', { version: 3 });
    expect(calls[0].method).toBe('GET');
    expect(calls[0].url).toBe('https://h.example.com/api/v1/agent-definitions/def-1?version=3');
  });

  it('get → drops undefined version query', async () => {
    const { client, calls } = makeClient();
    await client.agentDefinitions.get('def-1');
    expect(calls[0].url).toBe('https://h.example.com/api/v1/agent-definitions/def-1');
  });

  it('patch → PATCH with If-Match header', async () => {
    const { client, calls } = makeClient();
    await client.agentDefinitions.patch('def-1', 5, { name: 'new' });
    expect(calls[0].method).toBe('PATCH');
    expect(calls[0].headers['If-Match']).toBe('5');
    expect(calls[0].body).toEqual({ name: 'new' });
  });

  it('listVersions → GET :id/versions', async () => {
    const { client, calls } = makeClient();
    await client.agentDefinitions.listVersions('def-1');
    expect(calls[0].method).toBe('GET');
    expect(calls[0].url).toBe('https://h.example.com/api/v1/agent-definitions/def-1/versions');
  });

  it('archive → POST :id/archive', async () => {
    const { client, calls } = makeClient();
    await client.agentDefinitions.archive('def-1');
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toBe('https://h.example.com/api/v1/agent-definitions/def-1/archive');
  });
});

// ---------------------------------------------------------------------------
// Agents (4)
// ---------------------------------------------------------------------------

describe('client.agents', () => {
  it('create → POST /api/v1/agents', async () => {
    const { client, calls } = makeClient();
    await client.agents.create({
      definitionId: 'def-1',
      projectId: 'p',
      mode: 'chat',
      initialInput: 'hi',
    });
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toBe('https://h.example.com/api/v1/agents');
    expect(calls[0].body).toEqual({
      definitionId: 'def-1',
      projectId: 'p',
      mode: 'chat',
      initialInput: 'hi',
    });
  });

  it('list → GET with status filter', async () => {
    const { client, calls } = makeClient();
    await client.agents.list({ status: 'active' });
    expect(calls[0].url).toContain('status=active');
  });

  it('get → GET :id', async () => {
    const { client, calls } = makeClient();
    await client.agents.get('agt-1');
    expect(calls[0].method).toBe('GET');
    expect(calls[0].url).toBe('https://h.example.com/api/v1/agents/agt-1');
  });

  it('delete → DELETE :id', async () => {
    const { client, calls } = makeClient();
    await client.agents.delete('agt-1');
    expect(calls[0].method).toBe('DELETE');
    expect(calls[0].url).toBe('https://h.example.com/api/v1/agents/agt-1');
  });
});

// ---------------------------------------------------------------------------
// Runs (5)
// ---------------------------------------------------------------------------

describe('client.runs', () => {
  it('create → POST /:agentId/runs', async () => {
    const { client, calls } = makeClient();
    await client.runs.create('agt-1', { input: 'hi' });
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toBe('https://h.example.com/api/v1/agents/agt-1/runs');
    expect(calls[0].headers['Idempotency-Key']).toBeUndefined();
  });

  it('create with idempotencyKey attaches Idempotency-Key header', async () => {
    const { client, calls } = makeClient();
    await client.runs.create('agt-1', { input: 'hi' }, { idempotencyKey: 'abc-123' });
    expect(calls[0].headers['Idempotency-Key']).toBe('abc-123');
  });

  it('list → GET with status filter', async () => {
    const { client, calls } = makeClient();
    await client.runs.list('agt-1', { status: 'running' });
    expect(calls[0].url).toContain('/agents/agt-1/runs?');
    expect(calls[0].url).toContain('status=running');
  });

  it('get → GET :runId', async () => {
    const { client, calls } = makeClient();
    await client.runs.get('agt-1', 'run-1');
    expect(calls[0].url).toBe('https://h.example.com/api/v1/agents/agt-1/runs/run-1');
  });

  it('cancel → POST :runId/cancel', async () => {
    const { client, calls } = makeClient();
    await client.runs.cancel('agt-1', 'run-1');
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toBe('https://h.example.com/api/v1/agents/agt-1/runs/run-1/cancel');
  });
});

// ---------------------------------------------------------------------------
// Vaults, Skills, MCPs, Projects (3 + 1 + 1 + 3 = 8 more)
// ---------------------------------------------------------------------------

describe('client.vaults', () => {
  it('create / list / delete', async () => {
    const { client, calls } = makeClient();
    await client.vaults.create({
      scope: 'platform',
      name: 'k',
      credentialType: 'env_var',
      value: 'v',
    });
    await client.vaults.list({ scope: 'platform' });
    await client.vaults.delete('v-1');
    expect(calls.map((c) => c.method)).toEqual(['POST', 'GET', 'DELETE']);
    expect(calls[2].url).toBe('https://h.example.com/api/v1/vaults/entries/v-1');
  });
});

describe('client.skills / mcps / projects', () => {
  it('skills.list → GET /api/v1/skills', async () => {
    const { client, calls } = makeClient();
    await client.skills.list({ q: 'node' });
    expect(calls[0].url).toBe('https://h.example.com/api/v1/skills?q=node');
  });

  it('mcps.list → GET /api/v1/mcps', async () => {
    const { client, calls } = makeClient();
    await client.mcps.list();
    expect(calls[0].url).toBe('https://h.example.com/api/v1/mcps');
  });

  it('projects.create/list/get', async () => {
    const { client, calls } = makeClient();
    await client.projects.create({ name: 'demo', sandboxProvider: 'opensandbox' });
    await client.projects.list();
    await client.projects.get('p-1');
    expect(calls.map((c) => c.method)).toEqual(['POST', 'GET', 'GET']);
    expect(calls[2].url).toBe('https://h.example.com/api/v1/projects/p-1');
  });
});

// ---------------------------------------------------------------------------
// Authorization + return shape
// ---------------------------------------------------------------------------

describe('OpenRushClient auth + return', () => {
  it('sends Authorization: Bearer <token> on every call', async () => {
    const { client, calls } = makeClient();
    await client.agents.list();
    await client.projects.list();
    for (const c of calls) {
      expect(c.headers.Authorization).toBe('Bearer sk_test_abc');
    }
  });

  it('returns the parsed envelope from resource methods', async () => {
    const { client } = makeClient({
      data: { id: 'p-1', name: 'demo', description: null },
    });
    const out = await client.projects.get('p-1');
    expect(out).toEqual({
      data: { id: 'p-1', name: 'demo', description: null },
    });
  });

  it('omits Authorization when no token is provided (session cookie flow)', async () => {
    const calls: CapturedRequest[] = [];
    const fetchImpl: FetchLike = async (input, init = {}) => {
      const url = typeof input === 'string' ? input : input.toString();
      calls.push({
        url,
        method: init.method ?? 'GET',
        headers: { ...((init.headers ?? {}) as Record<string, string>) },
      });
      return new Response(JSON.stringify({ data: {} }), { status: 200 });
    };
    const client = new OpenRushClient({
      baseUrl: 'https://h',
      fetch: fetchImpl,
    });
    await client.agents.list();
    expect(calls[0].headers.Authorization).toBeUndefined();
  });
});
