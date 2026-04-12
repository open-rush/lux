export type VersionStatus = 'building' | 'built' | 'published' | 'failed';

export interface Version {
  id: string;
  projectId: string;
  version: number;
  status: VersionStatus;
  title: string | null;
  artifactPath: string | null;
  artifactSize: number | null;
  buildLog: string | null;
  metadata: unknown;
  createdBy: string | null;
  createdAt: Date;
  publishedAt: Date | null;
}

export interface CreateVersionInput {
  projectId: string;
  title?: string;
  createdBy?: string;
}

export interface VersionDb {
  getNextVersion(projectId: string): Promise<number>;
  create(input: CreateVersionInput & { version: number }): Promise<Version>;
  findById(id: string): Promise<Version | null>;
  listByProject(projectId: string, limit?: number): Promise<Version[]>;
  updateStatus(
    id: string,
    status: VersionStatus,
    extra?: Partial<Pick<Version, 'artifactPath' | 'artifactSize' | 'buildLog' | 'publishedAt'>>
  ): Promise<Version | null>;
  findLatestPublished(projectId: string): Promise<Version | null>;
}

export class VersionService {
  constructor(private db: VersionDb) {}

  async createVersion(input: CreateVersionInput): Promise<Version> {
    const nextVersion = await this.db.getNextVersion(input.projectId);
    return this.db.create({ ...input, version: nextVersion });
  }

  async getById(id: string): Promise<Version | null> {
    return this.db.findById(id);
  }

  async listByProject(projectId: string, limit = 20): Promise<Version[]> {
    return this.db.listByProject(projectId, limit);
  }

  async markBuilt(id: string, artifactPath: string, artifactSize: number): Promise<Version> {
    const updated = await this.db.updateStatus(id, 'built', { artifactPath, artifactSize });
    if (!updated) throw new Error('Version not found');
    return updated;
  }

  async markFailed(id: string, buildLog: string): Promise<Version> {
    const updated = await this.db.updateStatus(id, 'failed', { buildLog });
    if (!updated) throw new Error('Version not found');
    return updated;
  }

  async publish(id: string): Promise<Version> {
    const version = await this.db.findById(id);
    if (!version) throw new Error('Version not found');
    if (version.status !== 'built') {
      throw new Error(`Cannot publish version with status '${version.status}', must be 'built'`);
    }
    const updated = await this.db.updateStatus(id, 'published', { publishedAt: new Date() });
    if (!updated) throw new Error('Version not found');
    return updated;
  }

  async rollback(projectId: string): Promise<Version | null> {
    return this.db.findLatestPublished(projectId);
  }
}
