import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { createCryptoService, generateMasterKey } from '../vault/crypto.js';
import {
  type VaultEntry,
  type VaultScope,
  VaultService,
  type VaultStorage,
} from '../vault/vault-service.js';

class InMemoryVaultStorage implements VaultStorage {
  private entries = new Map<string, { entry: VaultEntry; encryptedValue: string }>();

  private key(scope: VaultScope, name: string, projectId?: string | null): string {
    return `${scope}:${projectId ?? ''}:${name}`;
  }

  async upsert(data: {
    scope: VaultScope;
    projectId: string | null;
    ownerId: string | null;
    name: string;
    credentialType: string;
    encryptedValue: string;
    keyVersion: number;
    injectionTarget: string | null;
  }): Promise<VaultEntry> {
    const k = this.key(data.scope, data.name, data.projectId);
    const now = new Date();
    const entry: VaultEntry = {
      id: this.entries.get(k)?.entry.id ?? randomUUID(),
      scope: data.scope,
      projectId: data.projectId,
      ownerId: data.ownerId,
      name: data.name,
      credentialType: data.credentialType,
      keyVersion: data.keyVersion,
      injectionTarget: data.injectionTarget,
      createdAt: this.entries.get(k)?.entry.createdAt ?? now,
      updatedAt: now,
    };
    this.entries.set(k, { entry, encryptedValue: data.encryptedValue });
    return entry;
  }

  async findByName(
    scope: VaultScope,
    name: string,
    projectId?: string | null
  ): Promise<{ entry: VaultEntry; encryptedValue: string } | null> {
    return this.entries.get(this.key(scope, name, projectId)) ?? null;
  }

  async listByScope(scope: VaultScope, projectId?: string | null): Promise<VaultEntry[]> {
    return Array.from(this.entries.values())
      .filter((e) => e.entry.scope === scope && e.entry.projectId === (projectId ?? null))
      .map((e) => e.entry);
  }

  async remove(scope: VaultScope, name: string, projectId?: string | null): Promise<boolean> {
    return this.entries.delete(this.key(scope, name, projectId));
  }

  async findAllForInjection(projectId: string): Promise<
    Array<{
      name: string;
      encryptedValue: string;
      scope: VaultScope;
      injectionTarget: string | null;
    }>
  > {
    return Array.from(this.entries.values())
      .filter(
        (e) =>
          e.entry.scope === 'platform' ||
          (e.entry.scope === 'project' && e.entry.projectId === projectId)
      )
      .map((e) => ({
        name: e.entry.name,
        encryptedValue: e.encryptedValue,
        scope: e.entry.scope as VaultScope,
        injectionTarget: e.entry.injectionTarget,
      }));
  }
}

describe('VaultService', () => {
  let service: VaultService;
  let storage: InMemoryVaultStorage;

  beforeEach(() => {
    const crypto = createCryptoService(generateMasterKey());
    storage = new InMemoryVaultStorage();
    service = new VaultService(crypto, storage);
  });

  describe('store and retrieve', () => {
    it('stores and retrieves a credential', async () => {
      await service.store('platform', 'ANTHROPIC_API_KEY', 'sk-ant-test-key');
      const value = await service.retrieve('platform', 'ANTHROPIC_API_KEY');
      expect(value).toBe('sk-ant-test-key');
    });

    it('returns null for non-existent credential', async () => {
      const value = await service.retrieve('platform', 'NONEXISTENT');
      expect(value).toBeNull();
    });

    it('updates existing credential on re-store', async () => {
      await service.store('platform', 'KEY', 'old-value');
      await service.store('platform', 'KEY', 'new-value');
      const value = await service.retrieve('platform', 'KEY');
      expect(value).toBe('new-value');
    });

    it('stores project-scoped credential', async () => {
      const projectId = randomUUID();
      await service.store('project', 'DB_URL', 'postgres://...', { projectId });
      const value = await service.retrieve('project', 'DB_URL', projectId);
      expect(value).toBe('postgres://...');
    });

    it('rejects project-scoped credential without projectId', async () => {
      await expect(service.store('project', 'KEY', 'value')).rejects.toThrow(
        'projectId is required for project-scoped credentials'
      );
    });
  });

  describe('list', () => {
    it('lists platform credentials without values', async () => {
      await service.store('platform', 'KEY_A', 'value-a');
      await service.store('platform', 'KEY_B', 'value-b');
      const entries = await service.list('platform');
      expect(entries).toHaveLength(2);
      expect(entries.map((e) => e.name).sort()).toEqual(['KEY_A', 'KEY_B']);
    });
  });

  describe('remove', () => {
    it('removes a credential', async () => {
      await service.store('platform', 'KEY', 'value');
      const removed = await service.remove('platform', 'KEY');
      expect(removed).toBe(true);
      const value = await service.retrieve('platform', 'KEY');
      expect(value).toBeNull();
    });

    it('returns false for non-existent', async () => {
      const removed = await service.remove('platform', 'NOPE');
      expect(removed).toBe(false);
    });

    it('rejects project-scoped remove without projectId', async () => {
      await expect(service.remove('project', 'KEY')).rejects.toThrow(
        'projectId is required for project-scoped credentials'
      );
    });
  });

  describe('scope validation', () => {
    it('rejects project-scoped retrieve without projectId', async () => {
      await expect(service.retrieve('project', 'KEY')).rejects.toThrow(
        'projectId is required for project-scoped credentials'
      );
    });

    it('rejects project-scoped list without projectId', async () => {
      await expect(service.list('project')).rejects.toThrow(
        'projectId is required for project-scoped credentials'
      );
    });
  });

  describe('resolveForSandbox', () => {
    it('merges platform and project credentials', async () => {
      const projectId = randomUUID();
      await service.store('platform', 'ANTHROPIC_API_KEY', 'platform-key');
      await service.store('platform', 'AWS_REGION', 'us-west-2');
      await service.store('project', 'CUSTOM_TOKEN', 'project-token', { projectId });

      const env = await service.resolveForSandbox(projectId);
      expect(env.ANTHROPIC_API_KEY).toBe('platform-key');
      expect(env.AWS_REGION).toBe('us-west-2');
      expect(env.CUSTOM_TOKEN).toBe('project-token');
    });

    it('project credentials override platform with same name', async () => {
      const projectId = randomUUID();
      await service.store('platform', 'API_KEY', 'platform-value');
      await service.store('project', 'API_KEY', 'project-value', { projectId });

      const env = await service.resolveForSandbox(projectId);
      expect(env.API_KEY).toBe('project-value');
    });

    it('uses injectionTarget as env var name when set', async () => {
      await service.store('platform', 'anthropic-key', 'sk-test', {
        injectionTarget: 'ANTHROPIC_API_KEY',
      });

      const env = await service.resolveForSandbox(randomUUID());
      expect(env.ANTHROPIC_API_KEY).toBe('sk-test');
      expect(env['anthropic-key']).toBeUndefined();
    });

    it('returns empty map for project with no credentials', async () => {
      const env = await service.resolveForSandbox(randomUUID());
      expect(env).toEqual({});
    });
  });
});
