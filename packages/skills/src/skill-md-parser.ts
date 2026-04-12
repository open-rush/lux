export interface SkillMetadata {
  name: string;
  description: string;
  version?: string;
  author?: string;
  triggers?: string[];
  tools?: string[];
  permissions?: string[];
}

export interface ParsedSkill {
  metadata: SkillMetadata;
  content: string;
  rawFrontmatter: string;
}

export function parseSkillMd(source: string): ParsedSkill {
  const frontmatterMatch = source.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n([\s\S]*))?$/);

  if (!frontmatterMatch) {
    return {
      metadata: { name: 'unknown', description: '' },
      content: source.trim(),
      rawFrontmatter: '',
    };
  }

  const rawFrontmatter = frontmatterMatch[1];
  const content = (frontmatterMatch[2] ?? '').trim();
  const metadata = parseFrontmatter(rawFrontmatter);

  return { metadata, content, rawFrontmatter };
}

function parseFrontmatter(raw: string): SkillMetadata {
  const lines = raw.split('\n');
  const data: Record<string, string | string[]> = {};

  for (const line of lines) {
    const match = line.match(/^(\w+)\s*:\s*(.+)$/);
    if (match) {
      const key = match[1].trim();
      const value = match[2].trim();

      if (value.startsWith('[') && value.endsWith(']')) {
        data[key] = value
          .slice(1, -1)
          .split(',')
          .map((s) => s.trim().replace(/^["']|["']$/g, ''));
      } else {
        data[key] = value.replace(/^["']|["']$/g, '');
      }
    }
  }

  return {
    name: (data.name as string) ?? 'unknown',
    description: (data.description as string) ?? '',
    version: data.version as string | undefined,
    author: data.author as string | undefined,
    triggers: Array.isArray(data.triggers) ? data.triggers : undefined,
    tools: Array.isArray(data.tools) ? data.tools : undefined,
    permissions: Array.isArray(data.permissions) ? data.permissions : undefined,
  };
}
