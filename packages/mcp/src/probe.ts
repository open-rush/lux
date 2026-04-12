import type { McpRegistry } from './registry.js';
import type { McpServerConfig } from './types.js';

export interface ProbeConfig {
  intervalMs: number;
  timeoutMs: number;
}

export const DEFAULT_PROBE_CONFIG: ProbeConfig = {
  intervalMs: 30_000,
  timeoutMs: 5_000,
};

export interface ProbeResult {
  serverId: string;
  healthy: boolean;
  responseTimeMs: number;
  error?: string;
}

export class McpProbe {
  constructor(
    private registry: McpRegistry,
    private config: ProbeConfig = DEFAULT_PROBE_CONFIG
  ) {}

  async checkHealth(server: McpServerConfig): Promise<ProbeResult> {
    const start = Date.now();

    try {
      if (server.transport === 'stdio') {
        return {
          serverId: server.id,
          healthy: true,
          responseTimeMs: Date.now() - start,
        };
      }

      if (server.url) {
        const response = await fetch(server.url, {
          method: 'HEAD',
          signal: AbortSignal.timeout(this.config.timeoutMs),
        });
        return {
          serverId: server.id,
          healthy: response.ok,
          responseTimeMs: Date.now() - start,
        };
      }

      return {
        serverId: server.id,
        healthy: false,
        responseTimeMs: Date.now() - start,
        error: 'No URL configured for health check',
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.registry.updateStatus(server.id, 'unreachable', message);
      return {
        serverId: server.id,
        healthy: false,
        responseTimeMs: Date.now() - start,
        error: message,
      };
    }
  }

  async checkAll(servers: McpServerConfig[]): Promise<ProbeResult[]> {
    return Promise.all(servers.map((s) => this.checkHealth(s)));
  }
}
