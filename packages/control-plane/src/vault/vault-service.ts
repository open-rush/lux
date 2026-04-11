import type { CryptoService } from './crypto.js';

export type VaultScope = 'platform' | 'project';

export interface VaultEntry {
  id: string;
  scope: VaultScope;
  projectId: string | null;
  ownerId: string | null;
  name: string;
  credentialType: string;
  keyVersion: number;
  injectionTarget: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface StoreOptions {
  projectId?: string;
  ownerId?: string;
  credentialType?: string;
  injectionTarget?: string;
}

export interface VaultStorage {
  upsert(entry: {
    scope: VaultScope;
    projectId: string | null;
    ownerId: string | null;
    name: string;
    credentialType: string;
    encryptedValue: string;
    keyVersion: number;
    injectionTarget: string | null;
  }): Promise<VaultEntry>;

  findByName(
    scope: VaultScope,
    name: string,
    projectId?: string | null
  ): Promise<{ entry: VaultEntry; encryptedValue: string } | null>;

  listByScope(scope: VaultScope, projectId?: string | null): Promise<VaultEntry[]>;

  remove(scope: VaultScope, name: string, projectId?: string | null): Promise<boolean>;

  findAllForInjection(projectId: string): Promise<
    Array<{
      name: string;
      encryptedValue: string;
      scope: VaultScope;
      injectionTarget: string | null;
    }>
  >;
}

export class VaultService {
  constructor(
    private crypto: CryptoService,
    private storage: VaultStorage
  ) {}

  async store(
    scope: VaultScope,
    name: string,
    plaintext: string,
    opts: StoreOptions = {}
  ): Promise<VaultEntry> {
    this.validateProjectId(scope, opts.projectId);
    const encrypted = this.crypto.encrypt(plaintext);
    return this.storage.upsert({
      scope,
      projectId: scope === 'project' ? (opts.projectId ?? null) : null,
      ownerId: opts.ownerId ?? null,
      name,
      credentialType: opts.credentialType ?? 'env',
      encryptedValue: encrypted,
      keyVersion: 1,
      injectionTarget: opts.injectionTarget ?? null,
    });
  }

  async retrieve(scope: VaultScope, name: string, projectId?: string): Promise<string | null> {
    this.validateProjectId(scope, projectId);
    const result = await this.storage.findByName(scope, name, projectId);
    if (!result) return null;
    return this.crypto.decrypt(result.encryptedValue);
  }

  async list(scope: VaultScope, projectId?: string): Promise<VaultEntry[]> {
    this.validateProjectId(scope, projectId);
    return this.storage.listByScope(scope, projectId);
  }

  async remove(scope: VaultScope, name: string, projectId?: string): Promise<boolean> {
    this.validateProjectId(scope, projectId);
    return this.storage.remove(scope, name, projectId);
  }

  private validateProjectId(scope: VaultScope, projectId?: string): void {
    if (scope === 'project' && !projectId) {
      throw new Error('projectId is required for project-scoped credentials');
    }
  }

  async resolveForSandbox(projectId: string, _userId?: string): Promise<Record<string, string>> {
    const entries = await this.storage.findAllForInjection(projectId);
    const env: Record<string, string> = {};

    const platformEntries = entries.filter((e) => e.scope === 'platform');
    const projectEntries = entries.filter((e) => e.scope === 'project');

    for (const entry of platformEntries) {
      const target = entry.injectionTarget ?? entry.name;
      env[target] = this.crypto.decrypt(entry.encryptedValue);
    }

    for (const entry of projectEntries) {
      const target = entry.injectionTarget ?? entry.name;
      env[target] = this.crypto.decrypt(entry.encryptedValue);
    }

    return env;
  }
}
