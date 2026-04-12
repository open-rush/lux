import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface ReskillConfig {
  npxPath?: string;
  registry?: string;
  globalInstall?: boolean;
}

export interface InstalledSkill {
  name: string;
  source: string;
  version?: string;
  path?: string;
}

export interface SearchResult {
  name: string;
  description: string;
  source: string;
  version?: string;
}

export class ReskillClient {
  private npxPath: string;
  private registry?: string;
  private globalInstall: boolean;

  constructor(config: ReskillConfig = {}) {
    this.npxPath = config.npxPath ?? 'npx';
    this.registry = config.registry;
    this.globalInstall = config.globalInstall ?? true;
  }

  async search(query: string, limit = 10): Promise<SearchResult[]> {
    const args = ['reskill@latest', 'find', query, '--json', '-l', String(limit)];
    if (this.registry) args.push('-r', this.registry);
    const { stdout } = await this.exec(args);
    try {
      return JSON.parse(stdout);
    } catch {
      return [];
    }
  }

  async install(
    skillRef: string,
    options: { agents?: string[]; force?: boolean; skillNames?: string[] } = {}
  ): Promise<void> {
    const args = ['reskill@latest', 'install', skillRef, '-y'];
    if (this.globalInstall) args.push('-g');
    if (options.force) args.push('-f');
    if (options.agents?.length) {
      args.push('-a', ...options.agents);
    }
    if (options.skillNames?.length) {
      for (const name of options.skillNames) {
        args.push('-s', name);
      }
    }
    await this.exec(args);
  }

  async uninstall(skillName: string): Promise<void> {
    const args = ['reskill@latest', 'uninstall', skillName];
    if (this.globalInstall) args.push('-g');
    await this.exec(args);
  }

  async list(): Promise<InstalledSkill[]> {
    const args = ['reskill@latest', 'list', '--json'];
    if (this.globalInstall) args.push('-g');
    const { stdout } = await this.exec(args);
    try {
      return JSON.parse(stdout);
    } catch {
      return [];
    }
  }

  async info(skillRef: string): Promise<Record<string, unknown> | null> {
    const args = ['reskill@latest', 'info', skillRef, '--json'];
    const { stdout } = await this.exec(args);
    try {
      return JSON.parse(stdout);
    } catch {
      return null;
    }
  }

  async update(skillName?: string): Promise<void> {
    const args = ['reskill@latest', 'update'];
    if (skillName) args.push(skillName);
    await this.exec(args);
  }

  private async exec(args: string[]): Promise<{ stdout: string; stderr: string }> {
    try {
      return await execFileAsync(this.npxPath, args, {
        timeout: 60_000,
        maxBuffer: 5 * 1024 * 1024,
      });
    } catch (error: unknown) {
      const execError = error as { stdout?: string; stderr?: string; code?: number };
      throw new Error(
        `reskill command failed: ${args.join(' ')}\n${execError.stderr ?? execError.stdout ?? 'Unknown error'}`
      );
    }
  }
}
