import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type {
  CreateVersionInput,
  Version,
  VersionDb,
  VersionStatus,
} from '../version/version-service.js';
import { VersionService } from '../version/version-service.js';

class InMemoryVersionDb implements VersionDb {
  private versions = new Map<string, Version>();

  async getNextVersion(projectId: string): Promise<number> {
    const projectVersions = Array.from(this.versions.values()).filter(
      (v) => v.projectId === projectId
    );
    if (projectVersions.length === 0) return 1;
    return Math.max(...projectVersions.map((v) => v.version)) + 1;
  }

  async create(input: CreateVersionInput & { version: number }): Promise<Version> {
    const version: Version = {
      id: randomUUID(),
      projectId: input.projectId,
      version: input.version,
      status: 'building',
      title: input.title ?? null,
      artifactPath: null,
      artifactSize: null,
      buildLog: null,
      metadata: null,
      createdBy: input.createdBy ?? null,
      createdAt: new Date(),
      publishedAt: null,
    };
    this.versions.set(version.id, version);
    return version;
  }

  async findById(id: string): Promise<Version | null> {
    return this.versions.get(id) ?? null;
  }

  async listByProject(projectId: string, limit = 20): Promise<Version[]> {
    return Array.from(this.versions.values())
      .filter((v) => v.projectId === projectId)
      .sort((a, b) => b.version - a.version)
      .slice(0, limit);
  }

  async updateStatus(
    id: string,
    status: VersionStatus,
    extra?: Partial<Pick<Version, 'artifactPath' | 'artifactSize' | 'buildLog' | 'publishedAt'>>
  ): Promise<Version | null> {
    const version = this.versions.get(id);
    if (!version) return null;
    version.status = status;
    if (extra?.artifactPath !== undefined) version.artifactPath = extra.artifactPath;
    if (extra?.artifactSize !== undefined) version.artifactSize = extra.artifactSize;
    if (extra?.buildLog !== undefined) version.buildLog = extra.buildLog;
    if (extra?.publishedAt !== undefined) version.publishedAt = extra.publishedAt;
    return version;
  }

  async findLatestPublished(projectId: string): Promise<Version | null> {
    const published = Array.from(this.versions.values())
      .filter((v) => v.projectId === projectId && v.status === 'published')
      .sort((a, b) => b.version - a.version);
    return published[0] ?? null;
  }
}

describe('VersionService', () => {
  let service: VersionService;
  const projectId = randomUUID();

  beforeEach(() => {
    service = new VersionService(new InMemoryVersionDb());
  });

  describe('createVersion', () => {
    it('creates version 1 for new project', async () => {
      const v = await service.createVersion({ projectId });
      expect(v.version).toBe(1);
      expect(v.status).toBe('building');
    });

    it('auto-increments version number', async () => {
      await service.createVersion({ projectId });
      const v2 = await service.createVersion({ projectId });
      expect(v2.version).toBe(2);
    });

    it('sets title when provided', async () => {
      const v = await service.createVersion({ projectId, title: 'Initial release' });
      expect(v.title).toBe('Initial release');
    });
  });

  describe('listByProject', () => {
    it('returns versions in descending order', async () => {
      await service.createVersion({ projectId });
      await service.createVersion({ projectId });
      await service.createVersion({ projectId });
      const list = await service.listByProject(projectId);
      expect(list.map((v) => v.version)).toEqual([3, 2, 1]);
    });

    it('respects limit', async () => {
      for (let i = 0; i < 5; i++) {
        await service.createVersion({ projectId });
      }
      const list = await service.listByProject(projectId, 3);
      expect(list).toHaveLength(3);
    });
  });

  describe('markBuilt', () => {
    it('updates status and artifact info', async () => {
      const v = await service.createVersion({ projectId });
      const built = await service.markBuilt(v.id, 's3://bucket/artifacts/v1.tar.gz', 1024);
      expect(built.status).toBe('built');
      expect(built.artifactPath).toBe('s3://bucket/artifacts/v1.tar.gz');
      expect(built.artifactSize).toBe(1024);
    });
  });

  describe('markFailed', () => {
    it('updates status and build log', async () => {
      const v = await service.createVersion({ projectId });
      const failed = await service.markFailed(v.id, 'Build error: module not found');
      expect(failed.status).toBe('failed');
      expect(failed.buildLog).toBe('Build error: module not found');
    });
  });

  describe('publish', () => {
    it('publishes a built version', async () => {
      const v = await service.createVersion({ projectId });
      await service.markBuilt(v.id, 's3://bucket/v1', 512);
      const published = await service.publish(v.id);
      expect(published.status).toBe('published');
      expect(published.publishedAt).toBeDefined();
    });

    it('rejects publishing non-built version', async () => {
      const v = await service.createVersion({ projectId });
      await expect(service.publish(v.id)).rejects.toThrow("status 'building'");
    });

    it('rejects publishing failed version', async () => {
      const v = await service.createVersion({ projectId });
      await service.markFailed(v.id, 'error');
      await expect(service.publish(v.id)).rejects.toThrow("status 'failed'");
    });
  });

  describe('rollback', () => {
    it('returns latest published version', async () => {
      const v1 = await service.createVersion({ projectId });
      await service.markBuilt(v1.id, 's3://v1', 100);
      await service.publish(v1.id);

      const v2 = await service.createVersion({ projectId });
      await service.markBuilt(v2.id, 's3://v2', 200);
      await service.publish(v2.id);

      const rollbackTarget = await service.rollback(projectId);
      expect(rollbackTarget?.version).toBe(2);
    });

    it('returns null when no published versions', async () => {
      expect(await service.rollback(projectId)).toBeNull();
    });
  });
});
