import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type OpenSandboxConfig, OpenSandboxProvider } from '../open-sandbox-provider.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides?: Partial<OpenSandboxConfig>): OpenSandboxConfig {
  return {
    apiUrl: 'http://localhost:8090',
    apiToken: 'test-token',
    execHost: 'localhost',
    ...overrides,
  };
}

function sandboxResponse(
  id: string,
  state = 'Running',
  embeddingPort = '12345',
  httpPort = '23456'
) {
  return {
    id,
    status: { state },
    metadata: {
      'opensandbox.io/embedding-proxy-port': embeddingPort,
      'opensandbox.io/http-port': httpPort,
    },
  };
}

function ndjsonBody(stdout: string, stderr = '', exitCode = 0): string {
  const lines = [
    JSON.stringify({ type: 'init', text: 'session-1', timestamp: 1 }),
    JSON.stringify({ type: 'ping', text: 'pong', timestamp: 2 }),
  ];
  if (stdout) {
    lines.push(JSON.stringify({ type: 'stdout', text: stdout, timestamp: 3 }));
  }
  if (stderr) {
    lines.push(JSON.stringify({ type: 'stderr', text: stderr, timestamp: 4 }));
  }
  lines.push(
    JSON.stringify({
      type: 'execution_complete',
      execution_time: 5,
      exit_code: exitCode,
      timestamp: 5,
    })
  );
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Mock fetch
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OpenSandboxProvider', () => {
  let provider: OpenSandboxProvider;

  beforeEach(() => {
    provider = new OpenSandboxProvider(makeConfig());
  });

  // -------------------------------------------------------------------------
  // create()
  // -------------------------------------------------------------------------

  describe('create()', () => {
    it('sends correct POST body and returns SandboxInfo', async () => {
      const sbx = sandboxResponse('sbx-1');

      // First call: POST /v1/sandboxes (create)
      // Second call: GET /v1/sandboxes/sbx-1 (poll — already Running)
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => sbx,
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => sbx,
        });

      const info = await provider.create({
        agentId: 'agent-1',
        env: { NODE_ENV: 'test' },
        ttlSeconds: 600,
      });

      // Verify POST call
      const [createUrl, createInit] = fetchMock.mock.calls[0];
      expect(createUrl).toBe('http://localhost:8090/v1/sandboxes');
      expect(createInit.method).toBe('POST');
      expect(createInit.headers.Authorization).toBe('Bearer test-token');

      const body = JSON.parse(createInit.body);
      expect(body.image).toEqual({ uri: 'node:22-slim' });
      expect(body.entrypoint).toEqual(['sleep', 'infinity']);
      expect(body.resourceLimits).toEqual({ cpu: '1000m', memory: '1024Mi' });
      expect(body.timeout).toBe(600);
      expect(body.env).toEqual({ NODE_ENV: 'test' });

      // Verify returned info
      expect(info.id).toBe('sbx-1');
      expect(info.status).toBe('running');
      expect(info.endpoint).toBe('http://localhost:23456');
    });

    it('uses custom image and entrypoint from config', async () => {
      provider = new OpenSandboxProvider(
        makeConfig({
          defaultImage: 'python:3.12',
          defaultEntrypoint: ['bash', '-c', 'sleep infinity'],
          defaultResource: { cpu: '2000m', memory: '2048Mi' },
          defaultTimeout: 600,
        })
      );

      const sbx = sandboxResponse('sbx-2');
      fetchMock
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => sbx })
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => sbx });

      await provider.create({ agentId: 'agent-1' });

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.image).toEqual({ uri: 'python:3.12' });
      expect(body.entrypoint).toEqual(['bash', '-c', 'sleep infinity']);
      expect(body.resourceLimits).toEqual({ cpu: '2000m', memory: '2048Mi' });
    });

    it('polls until sandbox reaches Running state', async () => {
      const creating = sandboxResponse('sbx-3', 'Creating');
      const running = sandboxResponse('sbx-3', 'Running');

      fetchMock
        // POST create
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => creating })
        // GET poll #1 — still Creating
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => creating })
        // GET poll #2 — Running
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => running });

      const info = await provider.create({ agentId: 'agent-1' });

      expect(info.status).toBe('running');
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('throws when sandbox never reaches Running', async () => {
      // Use a provider with very short poll timeouts so the test completes quickly
      const fastProvider = new OpenSandboxProvider(
        makeConfig({ pollIntervalMs: 10, maxPollMs: 50 })
      );

      const creating = sandboxResponse('sbx-timeout', 'Creating');

      // Always return Creating
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => creating,
      });

      await expect(fastProvider.create({ agentId: 'agent-1' })).rejects.toThrow(
        'did not reach Running state'
      );
    });

    it('caches execd port on successful create', async () => {
      const sbx = sandboxResponse('sbx-cached', 'Running', '55555');
      fetchMock
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => sbx })
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => sbx });

      await provider.create({ agentId: 'agent-1' });

      // exec should not need an extra getInfo call — port is cached
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => ndjsonBody('hello'),
      });

      const result = await provider.exec('sbx-cached', 'echo hello');
      expect(result.stdout).toBe('hello');

      // The exec call is the 3rd total call (create + poll + exec command)
      expect(fetchMock.mock.calls[2][0]).toBe('http://localhost:55555/command');
    });
  });

  // -------------------------------------------------------------------------
  // getInfo()
  // -------------------------------------------------------------------------

  describe('getInfo()', () => {
    it('returns mapped SandboxInfo', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => sandboxResponse('sbx-info', 'Running'),
      });

      const info = await provider.getInfo('sbx-info');
      expect(info).not.toBeNull();
      expect(info?.id).toBe('sbx-info');
      expect(info?.status).toBe('running');
      expect(info?.endpoint).toBe('http://localhost:23456');
      expect(info?.previewUrl).toBe('http://localhost:23456');
      expect(info?.createdAt).toBeInstanceOf(Date);
    });

    it('maps unknown state to creating', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => sandboxResponse('sbx-unknown', 'Pending'),
      });

      const info = await provider.getInfo('sbx-unknown');
      expect(info?.status).toBe('creating');
    });

    it('returns null on API error', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      const info = await provider.getInfo('sbx-missing');
      expect(info).toBeNull();
    });

    it('returns null endpoint when http-port metadata missing', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'sbx-no-port',
          status: { state: 'Running' },
          metadata: {},
        }),
      });

      const info = await provider.getInfo('sbx-no-port');
      expect(info?.endpoint).toBeNull();
      expect(info?.previewUrl).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // destroy()
  // -------------------------------------------------------------------------

  describe('destroy()', () => {
    it('sends DELETE request and clears port cache', async () => {
      // Pre-populate cache via create
      const sbx = sandboxResponse('sbx-destroy', 'Running', '11111');
      fetchMock
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => sbx })
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => sbx });

      await provider.create({ agentId: 'agent-1' });

      // DELETE
      fetchMock.mockResolvedValueOnce({ ok: true, status: 204 });
      await provider.destroy('sbx-destroy');

      const [deleteUrl, deleteInit] = fetchMock.mock.calls[2];
      expect(deleteUrl).toBe('http://localhost:8090/v1/sandboxes/sbx-destroy');
      expect(deleteInit.method).toBe('DELETE');

      // Port cache should be cleared — next exec needs to resolve port
      fetchMock
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => sbx })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => ndjsonBody('ok'),
        });

      await provider.exec('sbx-destroy', 'echo ok');

      // Should have called GET to resolve port (cache was cleared)
      expect(fetchMock.mock.calls[3][0]).toBe('http://localhost:8090/v1/sandboxes/sbx-destroy');
    });

    it('throws on API error', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      await expect(provider.destroy('sbx-fail')).rejects.toThrow('OpenSandbox API error: 500');
    });
  });

  // -------------------------------------------------------------------------
  // exec()
  // -------------------------------------------------------------------------

  describe('exec()', () => {
    it('parses NDJSON stdout correctly', async () => {
      // Resolve port
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => sandboxResponse('sbx-exec', 'Running', '9999'),
      });

      // exec command
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => ndjsonBody('hello world'),
      });

      const result = await provider.exec('sbx-exec', 'echo hello world');
      expect(result.stdout).toBe('hello world');
      expect(result.stderr).toBe('');
      expect(result.exitCode).toBe(0);
    });

    it('parses NDJSON stderr and non-zero exit code', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => sandboxResponse('sbx-err', 'Running', '8888'),
      });

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => ndjsonBody('', 'command not found', 127),
      });

      const result = await provider.exec('sbx-err', 'badcmd');
      expect(result.stdout).toBe('');
      expect(result.stderr).toBe('command not found');
      expect(result.exitCode).toBe(127);
    });

    it('accumulates multiple stdout lines', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => sandboxResponse('sbx-multi', 'Running', '7777'),
      });

      const multiStdout = [
        JSON.stringify({ type: 'init', text: 's1', timestamp: 1 }),
        JSON.stringify({ type: 'stdout', text: 'line1\n', timestamp: 2 }),
        JSON.stringify({ type: 'stdout', text: 'line2\n', timestamp: 3 }),
        JSON.stringify({ type: 'execution_complete', exit_code: 0, timestamp: 4 }),
      ].join('\n');

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => multiStdout,
      });

      const result = await provider.exec('sbx-multi', 'ls');
      expect(result.stdout).toBe('line1\nline2\n');
    });

    it('constructs correct execd URL', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => sandboxResponse('sbx-url', 'Running', '4444'),
      });

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => ndjsonBody('ok'),
      });

      await provider.exec('sbx-url', 'whoami');

      const [execUrl, execInit] = fetchMock.mock.calls[1];
      expect(execUrl).toBe('http://localhost:4444/command');
      expect(execInit.method).toBe('POST');
      expect(JSON.parse(execInit.body)).toEqual({ command: 'whoami' });
    });

    it('throws on execd HTTP error', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => sandboxResponse('sbx-execerr', 'Running', '3333'),
      });

      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      await expect(provider.exec('sbx-execerr', 'cmd')).rejects.toThrow('execd error: 500');
    });

    it('throws on invalid NDJSON', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => sandboxResponse('sbx-badjson', 'Running', '2222'),
      });

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => 'not-json-at-all',
      });

      await expect(provider.exec('sbx-badjson', 'cmd')).rejects.toThrow(
        'Failed to parse NDJSON line'
      );
    });

    it('throws when embedding-proxy-port metadata is missing', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'sbx-noport',
          status: { state: 'Running' },
          metadata: {},
        }),
      });

      await expect(provider.exec('sbx-noport', 'cmd')).rejects.toThrow(
        'missing embedding-proxy-port metadata'
      );
    });
  });

  // -------------------------------------------------------------------------
  // healthCheck()
  // -------------------------------------------------------------------------

  describe('healthCheck()', () => {
    it('returns true when exec succeeds', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => sandboxResponse('sbx-healthy', 'Running', '6666'),
      });

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => ndjsonBody('pong'),
      });

      const healthy = await provider.healthCheck('sbx-healthy');
      expect(healthy).toBe(true);
    });

    it('returns false when exec fails with non-zero exit code', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => sandboxResponse('sbx-unhealthy', 'Running', '5555'),
      });

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => ndjsonBody('', '', 1),
      });

      const healthy = await provider.healthCheck('sbx-unhealthy');
      expect(healthy).toBe(false);
    });

    it('returns false when exec throws', async () => {
      fetchMock.mockRejectedValueOnce(new Error('network error'));

      const healthy = await provider.healthCheck('sbx-down');
      expect(healthy).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // getEndpointUrl()
  // -------------------------------------------------------------------------

  describe('getEndpointUrl()', () => {
    it('returns URL with http-port from metadata', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => sandboxResponse('sbx-endpoint', 'Running', '12345', '8080'),
      });

      const url = await provider.getEndpointUrl('sbx-endpoint', 8787);
      expect(url).toBe('http://localhost:8080');
    });

    it('returns null when http-port metadata missing', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'sbx-no-http',
          status: { state: 'Running' },
          metadata: { 'opensandbox.io/embedding-proxy-port': '12345' },
        }),
      });

      const url = await provider.getEndpointUrl('sbx-no-http', 8787);
      expect(url).toBeNull();
    });

    it('uses custom execHost from config', async () => {
      provider = new OpenSandboxProvider(makeConfig({ execHost: '10.0.0.1' }));

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => sandboxResponse('sbx-custom', 'Running', '12345', '9090'),
      });

      const url = await provider.getEndpointUrl('sbx-custom', 8787);
      expect(url).toBe('http://10.0.0.1:9090');
    });
  });

  // -------------------------------------------------------------------------
  // Auth header
  // -------------------------------------------------------------------------

  describe('authentication', () => {
    it('includes Bearer token when apiToken is set', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => sandboxResponse('sbx-auth'),
      });

      await provider.getInfo('sbx-auth');

      const headers = fetchMock.mock.calls[0][1].headers;
      expect(headers.Authorization).toBe('Bearer test-token');
    });

    it('omits Authorization header when apiToken is not set', async () => {
      provider = new OpenSandboxProvider(makeConfig({ apiToken: undefined }));

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => sandboxResponse('sbx-noauth'),
      });

      await provider.getInfo('sbx-noauth');

      const headers = fetchMock.mock.calls[0][1].headers;
      expect(headers.Authorization).toBeUndefined();
    });
  });
});
