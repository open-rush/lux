import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { type McpConfigStore, McpRegistry } from '../registry.js';
import type { McpServerConfig } from '../types.js';

class InMemoryMcpStore implements McpConfigStore {
  private servers = new Map<string, McpServerConfig[]>();
  private key(scope: string, scopeId?: string | null) {
    return `${scope}:${scopeId ?? ''}`;
  }

  async getServers(scope: string, scopeId?: string): Promise<McpServerConfig[]> {
    return this.servers.get(this.key(scope, scopeId)) ?? [];
  }

  async addServer(scope: string, scopeId: string | null, config: McpServerConfig): Promise<void> {
    const k = this.key(scope, scopeId);
    const servers = this.servers.get(k) ?? [];
    servers.push(config);
    this.servers.set(k, servers);
  }

  async removeServer(scope: string, scopeId: string | null, serverId: string): Promise<boolean> {
    const k = this.key(scope, scopeId);
    const servers = this.servers.get(k) ?? [];
    const idx = servers.findIndex((s) => s.id === serverId);
    if (idx === -1) return false;
    servers.splice(idx, 1);
    return true;
  }

  async updateServer(
    scope: string,
    scopeId: string | null,
    serverId: string,
    update: Partial<McpServerConfig>
  ): Promise<boolean> {
    const k = this.key(scope, scopeId);
    const servers = this.servers.get(k) ?? [];
    const server = servers.find((s) => s.id === serverId);
    if (!server) return false;
    Object.assign(server, update);
    return true;
  }
}

function makeConfig(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    id: randomUUID(),
    name: 'test-server',
    transport: 'stdio',
    command: 'node',
    args: ['server.js'],
    enabled: true,
    scope: 'global',
    ...overrides,
  };
}

describe('McpRegistry', () => {
  let store: InMemoryMcpStore;
  let registry: McpRegistry;
  const projectId = randomUUID();
  const userId = randomUUID();

  beforeEach(() => {
    store = new InMemoryMcpStore();
    registry = new McpRegistry(store);
  });

  describe('getServersForProject', () => {
    it('merges global + project + user servers', async () => {
      const g = makeConfig({ id: 'g1', name: 'global', scope: 'global' });
      const p = makeConfig({ id: 'p1', name: 'project', scope: 'project' });
      const u = makeConfig({ id: 'u1', name: 'user', scope: 'user' });
      await registry.addServer('global', null, g);
      await registry.addServer('project', projectId, p);
      await registry.addServer('user', userId, u);

      const servers = await registry.getServersForProject(projectId, userId);
      expect(servers).toHaveLength(3);
    });

    it('project overrides global with same id', async () => {
      const g = makeConfig({ id: 'shared', name: 'global-version', scope: 'global' });
      const p = makeConfig({ id: 'shared', name: 'project-version', scope: 'project' });
      await registry.addServer('global', null, g);
      await registry.addServer('project', projectId, p);

      const servers = await registry.getServersForProject(projectId);
      expect(servers).toHaveLength(1);
      expect(servers[0].name).toBe('project-version');
    });

    it('filters out disabled servers', async () => {
      const enabled = makeConfig({ id: 'e1', enabled: true });
      const disabled = makeConfig({ id: 'd1', enabled: false });
      await registry.addServer('global', null, enabled);
      await registry.addServer('global', null, disabled);

      const servers = await registry.getServersForProject(projectId);
      expect(servers).toHaveLength(1);
    });
  });

  describe('addServer / removeServer', () => {
    it('adds and removes server', async () => {
      const config = makeConfig({ id: 'test' });
      await registry.addServer('project', projectId, config);
      let servers = await store.getServers('project', projectId);
      expect(servers).toHaveLength(1);

      await registry.removeServer('project', projectId, 'test');
      servers = await store.getServers('project', projectId);
      expect(servers).toHaveLength(0);
    });

    it('throws when removing non-existent', async () => {
      await expect(registry.removeServer('project', projectId, 'nope')).rejects.toThrow(
        'not found'
      );
    });
  });

  describe('enable/disable', () => {
    it('disables server', async () => {
      const config = makeConfig({ id: 'test', enabled: true });
      await registry.addServer('project', projectId, config);
      await registry.disableServer('project', projectId, 'test');
      const servers = await store.getServers('project', projectId);
      expect(servers[0].enabled).toBe(false);
    });

    it('enables server', async () => {
      const config = makeConfig({ id: 'test', enabled: false });
      await registry.addServer('project', projectId, config);
      await registry.enableServer('project', projectId, 'test');
      const servers = await store.getServers('project', projectId);
      expect(servers[0].enabled).toBe(true);
    });
  });

  describe('state management', () => {
    it('initializes and retrieves state', () => {
      const config = makeConfig({ id: 'test' });
      registry.initState(config);
      const state = registry.getState('test');
      expect(state?.status).toBe('stopped');
      expect(state?.error).toBeNull();
    });

    it('updates status', () => {
      const config = makeConfig({ id: 'test' });
      registry.initState(config);
      registry.updateStatus('test', 'running');
      expect(registry.getState('test')?.status).toBe('running');
    });

    it('updates status with error', () => {
      const config = makeConfig({ id: 'test' });
      registry.initState(config);
      registry.updateStatus('test', 'error', 'Connection refused');
      const state = registry.getState('test');
      expect(state?.status).toBe('error');
      expect(state?.error).toBe('Connection refused');
    });

    it('getAllStates returns all', () => {
      registry.initState(makeConfig({ id: 'a' }));
      registry.initState(makeConfig({ id: 'b' }));
      expect(registry.getAllStates()).toHaveLength(2);
    });
  });
});
