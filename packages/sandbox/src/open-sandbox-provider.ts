import type { CreateSandboxOptions, SandboxInfo, SandboxProvider } from './provider.js';

export interface OpenSandboxConfig {
  apiUrl: string;
  apiToken?: string;
  defaultImage?: string;
  defaultEntrypoint?: string[];
  defaultResource?: Record<string, string>;
  defaultTimeout?: number;
  execHost?: string;
  /** Poll interval when waiting for sandbox to become Running (ms). Default: 1000 */
  pollIntervalMs?: number;
  /** Max time to wait for sandbox to become Running (ms). Default: 30000 */
  maxPollMs?: number;
}

interface OpenSandboxMetadata {
  'opensandbox.io/embedding-proxy-port'?: string;
  'opensandbox.io/http-port'?: string;
  [key: string]: string | undefined;
}

interface OpenSandboxResponse {
  id: string;
  status: { state: string; message?: string };
  metadata?: OpenSandboxMetadata;
}

interface ExecdLine {
  type: 'init' | 'ping' | 'stdout' | 'stderr' | 'execution_complete';
  text?: string;
  execution_time?: number;
  exit_code?: number;
  timestamp: number;
}

const DEFAULT_IMAGE = 'node:22-slim';
const DEFAULT_ENTRYPOINT = ['sleep', 'infinity'];
const DEFAULT_RESOURCE = { cpu: '1000m', memory: '1024Mi' };
const DEFAULT_TIMEOUT = 300;
const DEFAULT_EXEC_HOST = 'localhost';

const POLL_INTERVAL_MS = 1_000;
const MAX_POLL_MS = 30_000;

export class OpenSandboxProvider implements SandboxProvider {
  private portCache = new Map<string, number>();

  constructor(private config: OpenSandboxConfig) {}

  async create(options: CreateSandboxOptions): Promise<SandboxInfo> {
    const body = {
      image: { uri: this.config.defaultImage ?? DEFAULT_IMAGE },
      entrypoint: this.config.defaultEntrypoint ?? DEFAULT_ENTRYPOINT,
      resourceLimits: this.config.defaultResource ?? DEFAULT_RESOURCE,
      timeout: options.ttlSeconds ?? this.config.defaultTimeout ?? DEFAULT_TIMEOUT,
      env: options.env,
    };

    const response = await this.request<OpenSandboxResponse>('POST', '/v1/sandboxes', body);

    // Wait for sandbox to be Running (poll up to 30s)
    const info = await this.waitForRunning(response.id);
    return info;
  }

  async destroy(sandboxId: string): Promise<void> {
    await this.request('DELETE', `/v1/sandboxes/${sandboxId}`);
    this.portCache.delete(sandboxId);
  }

  async getInfo(sandboxId: string): Promise<SandboxInfo | null> {
    try {
      const response = await this.request<OpenSandboxResponse>('GET', `/v1/sandboxes/${sandboxId}`);
      return this.mapResponse(response);
    } catch {
      return null;
    }
  }

  async healthCheck(sandboxId: string): Promise<boolean> {
    try {
      const result = await this.exec(sandboxId, 'echo pong');
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }

  async getEndpointUrl(sandboxId: string, _port: number): Promise<string | null> {
    const info = await this.request<OpenSandboxResponse>('GET', `/v1/sandboxes/${sandboxId}`);
    const httpPort = info.metadata?.['opensandbox.io/http-port'];
    if (!httpPort) return null;

    const execHost = this.config.execHost ?? DEFAULT_EXEC_HOST;
    return `http://${execHost}:${httpPort}`;
  }

  async exec(
    sandboxId: string,
    command: string
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const port = await this.resolveExecdPort(sandboxId);
    const execHost = this.config.execHost ?? DEFAULT_EXEC_HOST;
    const url = `http://${execHost}:${port}/command`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command }),
    });

    if (!response.ok) {
      throw new Error(`execd error: ${response.status} ${response.statusText}`);
    }

    const text = await response.text();
    return this.parseNdjson(text);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async resolveExecdPort(sandboxId: string): Promise<number> {
    const cached = this.portCache.get(sandboxId);
    if (cached !== undefined) return cached;

    const info = await this.request<OpenSandboxResponse>('GET', `/v1/sandboxes/${sandboxId}`);

    const portStr = info.metadata?.['opensandbox.io/embedding-proxy-port'];
    if (!portStr) {
      throw new Error(`Sandbox ${sandboxId} missing embedding-proxy-port metadata`);
    }

    const port = Number(portStr);
    this.portCache.set(sandboxId, port);
    return port;
  }

  private parseNdjson(text: string): { stdout: string; stderr: string; exitCode: number } {
    let stdout = '';
    let stderr = '';
    let exitCode = 0;

    const lines = text.split('\n').filter((l) => l.trim() !== '');
    for (const line of lines) {
      let parsed: ExecdLine;
      try {
        parsed = JSON.parse(line) as ExecdLine;
      } catch {
        throw new Error(`Failed to parse NDJSON line: ${line}`);
      }

      switch (parsed.type) {
        case 'stdout':
          stdout += parsed.text ?? '';
          break;
        case 'stderr':
          stderr += parsed.text ?? '';
          break;
        case 'execution_complete':
          exitCode = parsed.exit_code ?? 0;
          break;
        // init, ping — ignored
      }
    }

    return { stdout, stderr, exitCode };
  }

  private mapResponse(response: OpenSandboxResponse): SandboxInfo {
    const stateMap: Record<string, SandboxInfo['status']> = {
      Running: 'running',
      Creating: 'creating',
      Stopped: 'stopped',
      Destroyed: 'destroyed',
    };

    const httpPort = response.metadata?.['opensandbox.io/http-port'];
    const execHost = this.config.execHost ?? DEFAULT_EXEC_HOST;

    return {
      id: response.id,
      status: stateMap[response.status.state] ?? 'creating',
      endpoint: httpPort ? `http://${execHost}:${httpPort}` : null,
      previewUrl: httpPort ? `http://${execHost}:${httpPort}` : null,
      createdAt: new Date(),
    };
  }

  private async waitForRunning(sandboxId: string): Promise<SandboxInfo> {
    const maxPollMs = this.config.maxPollMs ?? MAX_POLL_MS;
    const pollIntervalMs = this.config.pollIntervalMs ?? POLL_INTERVAL_MS;
    const start = Date.now();

    while (Date.now() - start < maxPollMs) {
      const response = await this.request<OpenSandboxResponse>('GET', `/v1/sandboxes/${sandboxId}`);

      const { state } = response.status;

      if (state === 'Running') {
        // Cache the execd port early
        const portStr = response.metadata?.['opensandbox.io/embedding-proxy-port'];
        if (portStr) {
          this.portCache.set(sandboxId, Number(portStr));
        }
        return this.mapResponse(response);
      }

      // Fail fast on terminal error states
      const terminalStates = ['Destroyed', 'Stopped', 'Failed', 'Error'];
      if (terminalStates.includes(state)) {
        throw new Error(
          `Sandbox ${sandboxId} reached terminal state '${state}': ${response.status.message ?? 'unknown reason'}`
        );
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    throw new Error(`Sandbox ${sandboxId} did not reach Running state within ${maxPollMs}ms`);
  }

  private async request<T = Record<string, unknown>>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.config.apiToken) {
      headers.Authorization = `Bearer ${this.config.apiToken}`;
    }

    const response = await fetch(`${this.config.apiUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      throw new Error(`OpenSandbox API error: ${response.status} ${response.statusText}`);
    }

    if (response.status === 204) return {} as T;
    return response.json() as Promise<T>;
  }
}
