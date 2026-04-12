import type { McpServerConfig, McpServerState, McpServerStatus } from './types.js';

export interface McpConfigStore {
  getServers(scope: string, scopeId?: string): Promise<McpServerConfig[]>;
  addServer(scope: string, scopeId: string | null, config: McpServerConfig): Promise<void>;
  removeServer(scope: string, scopeId: string | null, serverId: string): Promise<boolean>;
  updateServer(
    scope: string,
    scopeId: string | null,
    serverId: string,
    update: Partial<McpServerConfig>
  ): Promise<boolean>;
}

export class McpRegistry {
  private states = new Map<string, McpServerState>();

  constructor(private store: McpConfigStore) {}

  async getServersForProject(projectId: string, userId?: string): Promise<McpServerConfig[]> {
    const globalServers = await this.store.getServers('global');
    const projectServers = await this.store.getServers('project', projectId);
    const userServers = userId ? await this.store.getServers('user', userId) : [];

    const merged = new Map<string, McpServerConfig>();
    for (const s of globalServers) merged.set(s.id, s);
    for (const s of projectServers) merged.set(s.id, s);
    for (const s of userServers) merged.set(s.id, s);

    return Array.from(merged.values()).filter((s) => s.enabled);
  }

  async addServer(scope: string, scopeId: string | null, config: McpServerConfig): Promise<void> {
    await this.store.addServer(scope, scopeId, config);
  }

  async removeServer(scope: string, scopeId: string | null, serverId: string): Promise<void> {
    const removed = await this.store.removeServer(scope, scopeId, serverId);
    if (!removed) throw new Error(`MCP server '${serverId}' not found`);
    this.states.delete(serverId);
  }

  async enableServer(scope: string, scopeId: string | null, serverId: string): Promise<void> {
    const updated = await this.store.updateServer(scope, scopeId, serverId, { enabled: true });
    if (!updated) throw new Error(`MCP server '${serverId}' not found`);
  }

  async disableServer(scope: string, scopeId: string | null, serverId: string): Promise<void> {
    const updated = await this.store.updateServer(scope, scopeId, serverId, { enabled: false });
    if (!updated) throw new Error(`MCP server '${serverId}' not found`);
  }

  updateStatus(serverId: string, status: McpServerStatus, error?: string): void {
    const current = this.states.get(serverId);
    if (current) {
      current.status = status;
      current.error = error ?? null;
      current.lastHealthCheck = new Date();
    }
  }

  getState(serverId: string): McpServerState | undefined {
    return this.states.get(serverId);
  }

  getAllStates(): McpServerState[] {
    return Array.from(this.states.values());
  }

  initState(config: McpServerConfig): void {
    this.states.set(config.id, {
      config,
      status: 'stopped',
      lastHealthCheck: null,
      error: null,
      pid: null,
    });
  }
}
