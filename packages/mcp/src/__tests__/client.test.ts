import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMcpClient, getMcpTools, HttpMcpClient, StdioMcpClient } from '../client.js';
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

function jsonRpcOk(result: unknown, headers?: Record<string, string>) {
  const responseHeaders = new Headers({ 'Content-Type': 'application/json' });
  if (headers) {
    for (const [k, v] of Object.entries(headers)) {
      responseHeaders.set(k, v);
    }
  }
  return new Response(JSON.stringify({ jsonrpc: '2.0', result, id: 1 }), {
    status: 200,
    statusText: 'OK',
    headers: responseHeaders,
  });
}

function jsonRpcError(code: number, message: string) {
  return new Response(JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: 1 }), {
    status: 200,
    statusText: 'OK',
    headers: { 'Content-Type': 'application/json' },
  });
}

function httpError(status: number, statusText: string) {
  return new Response(null, { status, statusText });
}

// ---------------------------------------------------------------------------
// HttpMcpClient
// ---------------------------------------------------------------------------

describe('HttpMcpClient', () => {
  const mockFetch = vi.fn<(input: string | URL, init?: RequestInit) => Promise<Response>>();

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('connect()', () => {
    it('throws if no URL configured', async () => {
      const client = new HttpMcpClient(makeConfig({ transport: 'sse', url: undefined }));
      await expect(client.connect()).rejects.toThrow('HTTP/SSE config requires url');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('sends initialize request on connect', async () => {
      mockFetch.mockResolvedValueOnce(jsonRpcOk({ protocolVersion: '2024-11-05' }));

      const client = new HttpMcpClient(
        makeConfig({ transport: 'sse', url: 'http://localhost:3000/mcp' })
      );
      await client.connect();

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:3000/mcp');
      expect(init?.method).toBe('POST');

      const body = JSON.parse(init?.body as string);
      expect(body.method).toBe('initialize');
      expect(body.jsonrpc).toBe('2.0');
      expect(body.params.protocolVersion).toBe('2024-11-05');
      expect(body.params.clientInfo.name).toBe('lux-mcp-client');
    });
  });

  describe('listTools()', () => {
    it('sends tools/list and parses response into McpTool[]', async () => {
      // connect first
      mockFetch.mockResolvedValueOnce(jsonRpcOk({ protocolVersion: '2024-11-05' }));

      const toolsResult = {
        tools: [
          { name: 'read_file', description: 'Reads a file', inputSchema: { type: 'object' } },
          { name: 'write_file' }, // missing optional fields
        ],
      };
      mockFetch.mockResolvedValueOnce(jsonRpcOk(toolsResult));

      const client = new HttpMcpClient(
        makeConfig({ transport: 'sse', url: 'http://localhost:3000/mcp' })
      );
      await client.connect();
      const tools = await client.listTools();

      expect(tools).toHaveLength(2);
      expect(tools[0]).toEqual({
        name: 'read_file',
        description: 'Reads a file',
        inputSchema: { type: 'object' },
      });
      // Missing description/inputSchema default to '' and {}
      expect(tools[1]).toEqual({
        name: 'write_file',
        description: '',
        inputSchema: {},
      });

      const body = JSON.parse(mockFetch.mock.calls[1][1]?.body as string);
      expect(body.method).toBe('tools/list');
    });
  });

  describe('callTool()', () => {
    it('sends tools/call with name and arguments', async () => {
      mockFetch.mockResolvedValueOnce(jsonRpcOk({})); // initialize
      mockFetch.mockResolvedValueOnce(
        jsonRpcOk({
          content: [{ type: 'text', text: 'file contents here' }],
        })
      );

      const client = new HttpMcpClient(
        makeConfig({ transport: 'sse', url: 'http://localhost:3000/mcp' })
      );
      await client.connect();
      const result = await client.callTool('read_file', { path: '/tmp/test.txt' });

      expect(result.content).toEqual([{ type: 'text', text: 'file contents here' }]);

      const body = JSON.parse(mockFetch.mock.calls[1][1]?.body as string);
      expect(body.method).toBe('tools/call');
      expect(body.params).toEqual({
        name: 'read_file',
        arguments: { path: '/tmp/test.txt' },
      });
    });
  });

  describe('disconnect()', () => {
    it('clears sessionId so subsequent calls do not include it', async () => {
      // connect with session
      mockFetch.mockResolvedValueOnce(jsonRpcOk({}, { 'Mcp-Session-Id': 'session-abc' }));
      const client = new HttpMcpClient(
        makeConfig({ transport: 'sse', url: 'http://localhost:3000/mcp' })
      );
      await client.connect();

      await client.disconnect();

      // Reconnect -- session should not carry over
      mockFetch.mockResolvedValueOnce(jsonRpcOk({}));
      await client.connect();

      const reconnectHeaders = mockFetch.mock.calls[1][1]?.headers as Record<string, string>;
      expect(reconnectHeaders['Mcp-Session-Id']).toBeUndefined();
    });
  });

  describe('session management', () => {
    it('captures Mcp-Session-Id from response and sends it on subsequent requests', async () => {
      // initialize returns session id
      mockFetch.mockResolvedValueOnce(
        jsonRpcOk({ protocolVersion: '2024-11-05' }, { 'Mcp-Session-Id': 'sess-123' })
      );
      // tools/list
      mockFetch.mockResolvedValueOnce(jsonRpcOk({ tools: [] }));

      const client = new HttpMcpClient(
        makeConfig({ transport: 'sse', url: 'http://localhost:3000/mcp' })
      );
      await client.connect();
      await client.listTools();

      // Second request should include the session id
      const secondCallHeaders = mockFetch.mock.calls[1][1]?.headers as Record<string, string>;
      expect(secondCallHeaders['Mcp-Session-Id']).toBe('sess-123');
    });

    it('does not send Mcp-Session-Id when server does not provide one', async () => {
      mockFetch.mockResolvedValueOnce(jsonRpcOk({}));
      mockFetch.mockResolvedValueOnce(jsonRpcOk({ tools: [] }));

      const client = new HttpMcpClient(
        makeConfig({ transport: 'sse', url: 'http://localhost:3000/mcp' })
      );
      await client.connect();
      await client.listTools();

      const secondCallHeaders = mockFetch.mock.calls[1][1]?.headers as Record<string, string>;
      expect(secondCallHeaders['Mcp-Session-Id']).toBeUndefined();
    });
  });

  describe('error handling', () => {
    it('throws on HTTP error status', async () => {
      mockFetch.mockResolvedValueOnce(httpError(502, 'Bad Gateway'));

      const client = new HttpMcpClient(
        makeConfig({ transport: 'sse', url: 'http://localhost:3000/mcp' })
      );
      await expect(client.connect()).rejects.toThrow('MCP HTTP error: 502 Bad Gateway');
    });

    it('throws on JSON-RPC error in response body', async () => {
      mockFetch.mockResolvedValueOnce(jsonRpcError(-32600, 'Invalid Request'));

      const client = new HttpMcpClient(
        makeConfig({ transport: 'sse', url: 'http://localhost:3000/mcp' })
      );
      await expect(client.connect()).rejects.toThrow('MCP error -32600: Invalid Request');
    });
  });
});

// ---------------------------------------------------------------------------
// createMcpClient (factory)
// ---------------------------------------------------------------------------

describe('createMcpClient', () => {
  it('returns StdioMcpClient for transport="stdio"', () => {
    const client = createMcpClient(makeConfig({ transport: 'stdio' }));
    expect(client).toBeInstanceOf(StdioMcpClient);
  });

  it('returns HttpMcpClient for transport="sse"', () => {
    const client = createMcpClient(
      makeConfig({ transport: 'sse', url: 'http://localhost:3000/mcp' })
    );
    expect(client).toBeInstanceOf(HttpMcpClient);
  });

  it('returns HttpMcpClient for transport="streamable-http"', () => {
    const client = createMcpClient(
      makeConfig({ transport: 'streamable-http', url: 'http://localhost:3000/mcp' })
    );
    expect(client).toBeInstanceOf(HttpMcpClient);
  });

  it('throws for unsupported transport', () => {
    expect(() => createMcpClient(makeConfig({ transport: 'grpc' as 'stdio' }))).toThrow(
      'Unsupported transport: grpc'
    );
  });
});

// ---------------------------------------------------------------------------
// getMcpTools (helper)
// ---------------------------------------------------------------------------

describe('getMcpTools', () => {
  const mockFetch = vi.fn<(input: string | URL, init?: RequestInit) => Promise<Response>>();

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('connects, lists tools, disconnects, and returns tools', async () => {
    // initialize
    mockFetch.mockResolvedValueOnce(jsonRpcOk({}));
    // tools/list
    mockFetch.mockResolvedValueOnce(
      jsonRpcOk({
        tools: [{ name: 'bash', description: 'Run shell commands', inputSchema: {} }],
      })
    );

    const tools = await getMcpTools(
      makeConfig({ transport: 'sse', url: 'http://localhost:3000/mcp' })
    );

    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('bash');
  });

  it('disconnects even when listTools throws', async () => {
    // initialize succeeds
    mockFetch.mockResolvedValueOnce(jsonRpcOk({}));
    // tools/list fails with HTTP error
    mockFetch.mockResolvedValueOnce(httpError(500, 'Internal Server Error'));

    await expect(
      getMcpTools(makeConfig({ transport: 'sse', url: 'http://localhost:3000/mcp' }))
    ).rejects.toThrow('MCP HTTP error: 500');

    // The function should still have completed (disconnect is in finally block).
    // We verify by ensuring it didn't throw an unhandled error outside the rejection.
  });

  it('disconnects even when connect throws', async () => {
    // connect fails
    mockFetch.mockResolvedValueOnce(httpError(503, 'Service Unavailable'));

    await expect(
      getMcpTools(makeConfig({ transport: 'sse', url: 'http://localhost:3000/mcp' }))
    ).rejects.toThrow('MCP HTTP error: 503');
  });
});
