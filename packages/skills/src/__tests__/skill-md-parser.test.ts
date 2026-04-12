import { describe, expect, it } from 'vitest';
import { parseSkillMd } from '../skill-md-parser.js';

describe('parseSkillMd', () => {
  it('parses complete SKILL.md with frontmatter', () => {
    const source = `---
name: commit
description: Create git commits with conventional format
version: 1.0.0
author: krislavten
triggers: ["/commit", "commit changes", "create commit"]
tools: [Bash, Read, Grep]
---

# Commit Skill

This skill creates conventional commits.`;

    const result = parseSkillMd(source);
    expect(result.metadata.name).toBe('commit');
    expect(result.metadata.description).toBe('Create git commits with conventional format');
    expect(result.metadata.version).toBe('1.0.0');
    expect(result.metadata.author).toBe('krislavten');
    expect(result.metadata.triggers).toEqual(['/commit', 'commit changes', 'create commit']);
    expect(result.metadata.tools).toEqual(['Bash', 'Read', 'Grep']);
    expect(result.content).toContain('# Commit Skill');
  });

  it('parses without frontmatter', () => {
    const source = '# Simple Skill\n\nJust instructions, no frontmatter.';
    const result = parseSkillMd(source);
    expect(result.metadata.name).toBe('unknown');
    expect(result.content).toContain('# Simple Skill');
  });

  it('parses with quoted values', () => {
    const source = `---
name: "my-skill"
description: 'A quoted description'
---

Content here.`;

    const result = parseSkillMd(source);
    expect(result.metadata.name).toBe('my-skill');
    expect(result.metadata.description).toBe('A quoted description');
  });

  it('parses permissions array', () => {
    const source = `---
name: deploy
description: Deploy to production
permissions: [write, admin]
---

Deploy instructions.`;

    const result = parseSkillMd(source);
    expect(result.metadata.permissions).toEqual(['write', 'admin']);
  });

  it('handles empty frontmatter values', () => {
    const source = `---
name: minimal
description: Minimal skill
---

Minimal content.`;

    const result = parseSkillMd(source);
    expect(result.metadata.name).toBe('minimal');
    expect(result.metadata.version).toBeUndefined();
    expect(result.metadata.triggers).toBeUndefined();
    expect(result.metadata.tools).toBeUndefined();
  });

  it('preserves raw frontmatter', () => {
    const source = `---
name: test
description: Test skill
---

Content.`;

    const result = parseSkillMd(source);
    expect(result.rawFrontmatter).toContain('name: test');
  });

  it('handles empty content', () => {
    const source = `---
name: empty
description: Empty content
---
`;

    const result = parseSkillMd(source);
    expect(result.content).toBe('');
  });
});
