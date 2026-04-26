/**
 * Tests for `http.ts` — the SDK's transport layer.
 *
 * Goal: prove that every request that flows through `performRequest` /
 * `performStreamRequest` attaches the right headers, serialises the
 * right body, and on error throws an `OpenRushApiError` whose fields
 * match the server's JSON envelope. We inject a fake `fetch` — no real
 * network. Without these tests the resource-namespace tests below would
 * be unable to distinguish a genuine contract bug from a transport bug.
 */

import { describe, expect, it } from 'vitest';
import { OpenRushApiError } from '../errors.js';
import { buildUrl, type FetchLike, performRequest, performStreamRequest } from '../http.js';

interface FakeRequest {
  url: string;
  init: RequestInit;
}

function makeFetch(respond: (req: FakeRequest) => Response | Promise<Response>): {
  fetch: FetchLike;
  calls: FakeRequest[];
} {
  const calls: FakeRequest[] = [];
  const fetchImpl: FetchLike = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.toString();
    const req: FakeRequest = { url, init };
    calls.push(req);
    return respond(req);
  };
  return { fetch: fetchImpl, calls };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('buildUrl', () => {
  it('joins absolute path onto baseUrl without a trailing slash', () => {
    expect(buildUrl('https://h.example.com', '/api/v1/agents')).toBe(
      'https://h.example.com/api/v1/agents'
    );
  });

  it('tolerates a trailing slash on baseUrl (no double-slash)', () => {
    expect(buildUrl('https://h.example.com/', '/api/v1/agents')).toBe(
      'https://h.example.com/api/v1/agents'
    );
  });

  it('appends query params, dropping null/undefined', () => {
    const url = buildUrl('https://h.example.com', '/api/v1/agents', {
      limit: 10,
      cursor: undefined,
      projectId: null,
      status: 'active',
    });
    expect(url).toContain('limit=10');
    expect(url).toContain('status=active');
    expect(url).not.toContain('cursor');
    expect(url).not.toContain('projectId');
  });

  it('URL-encodes query values', () => {
    const url = buildUrl('https://h.example.com', '/api/v1/skills', { q: 'hello world' });
    expect(url).toContain('q=hello+world');
  });
});

describe('performRequest — success paths', () => {
  it('GETs with Authorization and Accept headers', async () => {
    const { fetch, calls } = makeFetch(() => jsonResponse(200, { data: { id: 'x' } }));
    const out = await performRequest<{ data: { id: string } }>(
      { baseUrl: 'https://h', token: 'sk_test', fetch },
      { method: 'GET', path: '/api/v1/agents/x' }
    );
    expect(out.data.id).toBe('x');
    expect(calls).toHaveLength(1);
    const hdrs = calls[0].init.headers as Record<string, string>;
    expect(hdrs.Authorization).toBe('Bearer sk_test');
    expect(hdrs.Accept).toBe('application/json');
    // No Content-Type on a bodyless request.
    expect(hdrs['Content-Type']).toBeUndefined();
    expect(calls[0].init.body).toBeUndefined();
    expect(calls[0].url).toBe('https://h/api/v1/agents/x');
  });

  it('serialises JSON body and sets Content-Type on POST', async () => {
    const { fetch, calls } = makeFetch(() => jsonResponse(201, { data: { ok: true } }));
    await performRequest(
      { baseUrl: 'https://h', fetch },
      { method: 'POST', path: '/api/v1/projects', body: { name: 'demo' } }
    );
    const hdrs = calls[0].init.headers as Record<string, string>;
    expect(hdrs['Content-Type']).toBe('application/json');
    expect(calls[0].init.body).toBe(JSON.stringify({ name: 'demo' }));
  });

  it('returns undefined for 204 responses without parsing', async () => {
    const { fetch } = makeFetch(() => new Response(null, { status: 204 }));
    const out = await performRequest<undefined>(
      { baseUrl: 'https://h', fetch },
      { method: 'DELETE', path: '/api/v1/auth/tokens/x' }
    );
    expect(out).toBeUndefined();
  });

  it('merges defaultHeaders and per-request headers (request wins)', async () => {
    const { fetch, calls } = makeFetch(() => jsonResponse(200, { data: {} }));
    await performRequest(
      {
        baseUrl: 'https://h',
        defaultHeaders: { 'X-Client': 'sdk', 'X-Override': 'default' },
        fetch,
      },
      {
        method: 'GET',
        path: '/x',
        headers: { 'X-Override': 'per-request', 'If-Match': '3' },
      }
    );
    const hdrs = calls[0].init.headers as Record<string, string>;
    expect(hdrs['X-Client']).toBe('sdk');
    expect(hdrs['X-Override']).toBe('per-request');
    expect(hdrs['If-Match']).toBe('3');
  });

  it('propagates AbortSignal to fetch', async () => {
    let observed: AbortSignal | undefined;
    const { fetch } = makeFetch((req) => {
      observed = req.init.signal ?? undefined;
      return jsonResponse(200, { data: {} });
    });
    const ctrl = new AbortController();
    await performRequest(
      { baseUrl: 'https://h', fetch },
      { method: 'GET', path: '/x', signal: ctrl.signal }
    );
    expect(observed).toBe(ctrl.signal);
  });
});

describe('performRequest — error paths', () => {
  it('throws OpenRushApiError with envelope fields on 4xx', async () => {
    const { fetch } = makeFetch(() =>
      jsonResponse(409, {
        error: {
          code: 'VERSION_CONFLICT',
          message: 'stale read',
          hint: 'GET again',
        },
      })
    );
    await expect(
      performRequest({ baseUrl: 'https://h', fetch }, { method: 'PATCH', path: '/x' })
    ).rejects.toSatisfy((err) => {
      if (!(err instanceof OpenRushApiError)) return false;
      expect(err.status).toBe(409);
      expect(err.code).toBe('VERSION_CONFLICT');
      expect(err.message).toBe('stale read');
      expect(err.hint).toBe('GET again');
      return true;
    });
  });

  it('preserves issues[] on VALIDATION_ERROR', async () => {
    const { fetch } = makeFetch(() =>
      jsonResponse(400, {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'invalid',
          issues: [{ path: ['name'], message: 'required' }],
        },
      })
    );
    try {
      await performRequest({ baseUrl: 'https://h', fetch }, { method: 'POST', path: '/x' });
      throw new Error('should have thrown');
    } catch (err) {
      if (!(err instanceof OpenRushApiError)) throw err;
      expect(err.code).toBe('VALIDATION_ERROR');
      expect(err.issues).toEqual([{ path: ['name'], message: 'required' }]);
    }
  });

  it('synthesises INTERNAL when body is not a valid envelope', async () => {
    const { fetch } = makeFetch(() => new Response('Bad Gateway', { status: 502 }));
    try {
      await performRequest({ baseUrl: 'https://h', fetch }, { method: 'GET', path: '/x' });
      throw new Error('should have thrown');
    } catch (err) {
      if (!(err instanceof OpenRushApiError)) throw err;
      expect(err.status).toBe(502);
      expect(err.code).toBe('INTERNAL');
      expect(err.message).toBe('Bad Gateway');
    }
  });

  it('synthesises INTERNAL when body is empty', async () => {
    const { fetch } = makeFetch(() => new Response(null, { status: 500 }));
    try {
      await performRequest({ baseUrl: 'https://h', fetch }, { method: 'GET', path: '/x' });
      throw new Error('should have thrown');
    } catch (err) {
      if (!(err instanceof OpenRushApiError)) throw err;
      expect(err.status).toBe(500);
      expect(err.code).toBe('INTERNAL');
      expect(err.message).toBe('HTTP 500');
    }
  });
});

describe('performStreamRequest', () => {
  it('uses Accept: text/event-stream', async () => {
    const { fetch, calls } = makeFetch(
      () =>
        new Response('id: 1\ndata: {}\n\n', {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
    );
    await performStreamRequest(
      { baseUrl: 'https://h', fetch },
      { method: 'GET', path: '/api/v1/agents/x/runs/y/events' }
    );
    const hdrs = calls[0].init.headers as Record<string, string>;
    expect(hdrs.Accept).toBe('text/event-stream');
  });

  it('attaches Last-Event-ID when passed in headers', async () => {
    const { fetch, calls } = makeFetch(
      () =>
        new Response('', {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
    );
    await performStreamRequest(
      { baseUrl: 'https://h', fetch },
      { method: 'GET', path: '/e', headers: { 'Last-Event-ID': '42' } }
    );
    const hdrs = calls[0].init.headers as Record<string, string>;
    expect(hdrs['Last-Event-ID']).toBe('42');
  });

  it('throws OpenRushApiError on non-2xx, parsing envelope', async () => {
    const { fetch } = makeFetch(() =>
      jsonResponse(403, { error: { code: 'FORBIDDEN', message: 'no scope' } })
    );
    try {
      await performStreamRequest({ baseUrl: 'https://h', fetch }, { method: 'GET', path: '/e' });
      throw new Error('should have thrown');
    } catch (err) {
      if (!(err instanceof OpenRushApiError)) throw err;
      expect(err.status).toBe(403);
      expect(err.code).toBe('FORBIDDEN');
    }
  });

  it('throws when no fetch implementation is available and globalThis.fetch is absent', async () => {
    // Can't realistically delete globalThis.fetch in Node; instead test
    // the explicit branch by passing `fetch: undefined as any` and
    // stubbing the module-level globalThis check. We rely on the fact
    // that `opts.fetch ?? globalThis.fetch` is tested against this
    // specific null by explicit prop.
    //
    // Simulation: supply a signal-throwing implementation.
    const origFetch = globalThis.fetch;
    try {
      // @ts-expect-error — delete for this test
      globalThis.fetch = undefined;
      await expect(
        performStreamRequest({ baseUrl: 'https://h' }, { method: 'GET', path: '/e' })
      ).rejects.toThrow(/no fetch implementation/);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
