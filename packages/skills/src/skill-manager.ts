import type { ReskillClient, SearchResult } from './reskill-client.js';

export type SkillVisibility = 'public' | 'private';

export interface SkillConfig {
  name: string;
  source: string;
  visibility: SkillVisibility;
  enabled: boolean;
  allowedTools?: string[];
}

export interface SkillStore {
  getProjectSkills(projectId: string): Promise<SkillConfig[]>;
  addSkill(projectId: string, config: SkillConfig): Promise<void>;
  removeSkill(projectId: string, skillName: string): Promise<boolean>;
  updateSkill(projectId: string, skillName: string, update: Partial<SkillConfig>): Promise<boolean>;
}

export class SkillManager {
  constructor(
    private reskill: ReskillClient,
    private store: SkillStore
  ) {}

  async search(query: string): Promise<SearchResult[]> {
    return this.reskill.search(query);
  }

  async installForProject(
    projectId: string,
    skillRef: string,
    options: { visibility?: SkillVisibility; agents?: string[] } = {}
  ): Promise<void> {
    const existing = await this.store.getProjectSkills(projectId);
    if (existing.some((s) => s.name === skillRef)) {
      return;
    }

    await this.reskill.install(skillRef, { agents: options.agents ?? ['claude-code'] });

    await this.store.addSkill(projectId, {
      name: skillRef,
      source: skillRef,
      visibility: options.visibility ?? 'public',
      enabled: true,
    });
  }

  async uninstallFromProject(projectId: string, skillName: string): Promise<void> {
    const removed = await this.store.removeSkill(projectId, skillName);
    if (!removed) throw new Error(`Skill '${skillName}' not found in project`);
    await this.reskill.uninstall(skillName);
  }

  async listProjectSkills(projectId: string): Promise<SkillConfig[]> {
    return this.store.getProjectSkills(projectId);
  }

  async enableSkill(projectId: string, skillName: string): Promise<void> {
    const updated = await this.store.updateSkill(projectId, skillName, { enabled: true });
    if (!updated) throw new Error(`Skill '${skillName}' not found`);
  }

  async disableSkill(projectId: string, skillName: string): Promise<void> {
    const updated = await this.store.updateSkill(projectId, skillName, { enabled: false });
    if (!updated) throw new Error(`Skill '${skillName}' not found`);
  }

  async getEnabledSkills(projectId: string): Promise<SkillConfig[]> {
    const skills = await this.store.getProjectSkills(projectId);
    return skills.filter((s) => s.enabled);
  }

  async resolveForAgent(projectId: string): Promise<string[]> {
    const enabled = await this.getEnabledSkills(projectId);
    return enabled.map((s) => s.source);
  }
}
