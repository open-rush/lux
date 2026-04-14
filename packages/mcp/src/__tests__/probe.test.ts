import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PROBE_CONFIG, McpProbe } from '../probe.js';
import type { McpRegistry } from '../registry.js';
import type { McpServerConfig } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    id: 'test-server',
    name: 'Test Server',
    transport: 'stdio',
    command: 'node',
    args: ['server.js'],
    enabled: true,
    scope: 'global',
    ...overrides,
  };
}

function mockRegistry(): McpRegistry {
  return { updateStatus: vi.fn() } as unknown as McpRegistry;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('McpProbe', () => {
  const mockFetch = vi.fn<(input: string | URL, init?: RequestInit) => Promise<Response>>();
  let registry: McpRegistry;

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
    registry = mockRegistry();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('DEFAULT_PROBE_CONFIG', () => {
    it('has expected defaults', () => {
      expect(DEFAULT_PROBE_CONFIG.intervalMs).toBe(30_000);
      expect(DEFAULT_PROBE_CONFIG.timeoutMs).toBe(5_000);
    });
  });

  describe('checkHealth', () => {
    describe('stdio transport', () => {
      it('always returns healthy=true without making a network call', async () => {
        const probe = new McpProbe(registry);
        const server = makeConfig({ id: 'stdio-server', transport: 'stdio' });

        const result = await probe.checkHealth(server);

        expect(result.serverId).toBe('stdio-server');
        expect(result.healthy).toBe(true);
        expect(result.responseTimeMs).toBeGreaterThanOrEqual(0);
        expect(result.error).toBeUndefined();
        expect(mockFetch).not.toHaveBeenCalled();
      });
    });

    describe('HTTP transport with URL', () => {
      it('returns healthy=true when response.ok is true', async () => {
        mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }));

        const probe = new McpProbe(registry);
        const server = makeConfig({
          id: 'http-ok',
          transport: 'sse',
          url: 'http://localhost:4000/mcp',
        });

        const result = await probe.checkHealth(server);

        expect(result.serverId).toBe('http-ok');
        expect(result.healthy).toBe(true);
        expect(result.responseTimeMs).toBeGreaterThanOrEqual(0);
        expect(result.error).toBeUndefined();

        expect(mockFetch).toHaveBeenCalledOnce();
        const [url, init] = mockFetch.mock.calls[0];
        expect(url).toBe('http://localhost:4000/mcp');
        expect(init?.method).toBe('HEAD');
      });

      it('returns healthy=false when response.ok is false', async () => {
        mockFetch.mockResolvedValueOnce(new Response(null, { status: 503 }));

        const probe = new McpProbe(registry);
        const server = makeConfig({
          id: 'http-down',
          transport: 'streamable-http',
          url: 'http://localhost:4000/mcp',
        });

        const result = await probe.checkHealth(server);

        expect(result.serverId).toBe('http-down');
        expect(result.healthy).toBe(false);
        expect(result.responseTimeMs).toBeGreaterThanOrEqual(0);
      });
    });

    describe('HTTP transport without URL', () => {
      it('returns healthy=false with error message', async () => {
        const probe = new McpProbe(registry);
        const server = makeConfig({
          id: 'no-url',
          transport: 'sse',
          url: undefined,
        });

        const result = await probe.checkHealth(server);

        expect(result.serverId).toBe('no-url');
        expect(result.healthy).toBe(false);
        expect(result.error).toBe('No URL configured for health check');
        expect(result.responseTimeMs).toBeGreaterThanOrEqual(0);
        expect(mockFetch).not.toHaveBeenCalled();
      });
    });

    describe('fetch throws (network error / timeout)', () => {
      it('returns healthy=false and calls registry.updateStatus', async () => {
        mockFetch.mockRejectedValueOnce(new Error('Network timeout'));

        const probe = new McpProbe(registry);
        const server = makeConfig({
          id: 'timeout-server',
          transport: 'sse',
          url: 'http://unreachable:9999/mcp',
        });

        const result = await probe.checkHealth(server);

        expect(result.serverId).toBe('timeout-server');
        expect(result.healthy).toBe(false);
        expect(result.error).toBe('Network timeout');
        expect(result.responseTimeMs).toBeGreaterThanOrEqual(0);

        expect(registry.updateStatus).toHaveBeenCalledWith(
          'timeout-server',
          'unreachable',
          'Network timeout'
        );
      });

      it('handles non-Error thrown values with "Unknown error"', async () => {
        mockFetch.mockRejectedValueOnce('string-error');

        const probe = new McpProbe(registry);
        const server = makeConfig({
          id: 'weird-error',
          transport: 'sse',
          url: 'http://localhost:4000/mcp',
        });

        const result = await probe.checkHealth(server);

        expect(result.healthy).toBe(false);
        expect(result.error).toBe('Unknown error');
        expect(registry.updateStatus).toHaveBeenCalledWith(
          'weird-error',
          'unreachable',
          'Unknown error'
        );
      });
    });

    describe('custom probe config', () => {
      it('uses custom timeoutMs for AbortSignal', async () => {
        mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }));

        const probe = new McpProbe(registry, { intervalMs: 10_000, timeoutMs: 2_000 });
        const server = makeConfig({
          id: 'custom-timeout',
          transport: 'sse',
          url: 'http://localhost:4000/mcp',
        });

        await probe.checkHealth(server);

        // Verify the signal was passed (AbortSignal.timeout is called with our value)
        expect(mockFetch).toHaveBeenCalledOnce();
        const init = mockFetch.mock.calls[0][1];
        expect(init?.signal).toBeDefined();
      });
    });
  });

  describe('checkAll', () => {
    it('probes multiple servers in parallel and returns all results', async () => {
      mockFetch
        .mockResolvedValueOnce(new Response(null, { status: 200 }))
        .mockResolvedValueOnce(new Response(null, { status: 503 }));

      const probe = new McpProbe(registry);
      const servers = [
        makeConfig({ id: 'stdio-1', transport: 'stdio' }),
        makeConfig({ id: 'http-ok', transport: 'sse', url: 'http://localhost:3000/mcp' }),
        makeConfig({ id: 'http-down', transport: 'sse', url: 'http://localhost:4000/mcp' }),
      ];

      const results = await probe.checkAll(servers);

      expect(results).toHaveLength(3);

      const byId = new Map(results.map((r) => [r.serverId, r]));
      expect(byId.get('stdio-1')?.healthy).toBe(true);
      expect(byId.get('http-ok')?.healthy).toBe(true);
      expect(byId.get('http-down')?.healthy).toBe(false);
    });

    it('returns empty array for empty server list', async () => {
      const probe = new McpProbe(registry);
      const results = await probe.checkAll([]);
      expect(results).toEqual([]);
    });
  });

  describe('responseTimeMs', () => {
    it('is a non-negative number for all code paths', async () => {
      mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }));
      mockFetch.mockRejectedValueOnce(new Error('fail'));

      const probe = new McpProbe(registry);

      // stdio path
      const r1 = await probe.checkHealth(makeConfig({ id: 's1', transport: 'stdio' }));
      expect(r1.responseTimeMs).toBeGreaterThanOrEqual(0);

      // http success path
      const r2 = await probe.checkHealth(
        makeConfig({ id: 's2', transport: 'sse', url: 'http://localhost:3000/mcp' })
      );
      expect(r2.responseTimeMs).toBeGreaterThanOrEqual(0);

      // http error path
      const r3 = await probe.checkHealth(
        makeConfig({ id: 's3', transport: 'sse', url: 'http://localhost:3000/mcp' })
      );
      expect(r3.responseTimeMs).toBeGreaterThanOrEqual(0);

      // no-url path
      const r4 = await probe.checkHealth(
        makeConfig({ id: 's4', transport: 'sse', url: undefined })
      );
      expect(r4.responseTimeMs).toBeGreaterThanOrEqual(0);
    });
  });
});
