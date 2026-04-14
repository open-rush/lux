import { describe, expect, it } from 'vitest';
import {
  extractDescriptionFromFrontmatter,
  parseFrontmatter,
  parseGitHubUrl,
  parseGitLabUrl,
  sourceUrlToSkillMdRawUrl,
  stripFrontmatter,
} from '../skill-md-utils';

// ---------------------------------------------------------------------------
// parseGitHubUrl
// ---------------------------------------------------------------------------
describe('parseGitHubUrl', () => {
  it('parses a basic GitHub URL with defaults', () => {
    const result = parseGitHubUrl('https://github.com/owner/repo');
    expect(result).toEqual({
      owner: 'owner',
      repo: 'repo',
      branch: 'main',
      path: '',
    });
  });

  it('parses a URL with an explicit branch', () => {
    const result = parseGitHubUrl('https://github.com/owner/repo/tree/develop');
    expect(result).toEqual({
      owner: 'owner',
      repo: 'repo',
      branch: 'develop',
      path: '',
    });
  });

  it('parses a URL with branch and nested path', () => {
    const result = parseGitHubUrl('https://github.com/owner/repo/tree/main/path/to/dir');
    expect(result).toEqual({
      owner: 'owner',
      repo: 'repo',
      branch: 'main',
      path: 'path/to/dir',
    });
  });

  it('strips .git suffix from the repo name', () => {
    const result = parseGitHubUrl('https://github.com/owner/repo.git');
    expect(result).toEqual({
      owner: 'owner',
      repo: 'repo',
      branch: 'main',
      path: '',
    });
  });

  it('returns null for an invalid URL', () => {
    expect(parseGitHubUrl('not-a-url')).toBeNull();
  });

  it('returns null for a non-GitHub URL', () => {
    expect(parseGitHubUrl('https://gitlab.com/owner/repo')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseGitLabUrl
// ---------------------------------------------------------------------------
describe('parseGitLabUrl', () => {
  it('parses a basic GitLab URL with defaults', () => {
    const result = parseGitLabUrl('https://gitlab.com/owner/repo');
    expect(result).toEqual({
      host: 'https://gitlab.com',
      owner: 'owner',
      repo: 'repo',
      branch: 'main',
      path: '',
    });
  });

  it('parses a URL with an explicit branch', () => {
    const result = parseGitLabUrl('https://gitlab.com/owner/repo/-/tree/develop');
    expect(result).toEqual({
      host: 'https://gitlab.com',
      owner: 'owner',
      repo: 'repo',
      branch: 'develop',
      path: '',
    });
  });

  it('parses a URL with branch and nested path', () => {
    const result = parseGitLabUrl('https://gitlab.com/owner/repo/-/tree/main/path/to/dir');
    expect(result).toEqual({
      host: 'https://gitlab.com',
      owner: 'owner',
      repo: 'repo',
      branch: 'main',
      path: 'path/to/dir',
    });
  });

  it('parses a self-hosted GitLab URL', () => {
    const result = parseGitLabUrl('https://git.company.com/owner/repo');
    expect(result).toEqual({
      host: 'https://git.company.com',
      owner: 'owner',
      repo: 'repo',
      branch: 'main',
      path: '',
    });
  });

  it('returns null for an invalid URL', () => {
    expect(parseGitLabUrl('not-a-url')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// sourceUrlToSkillMdRawUrl
// ---------------------------------------------------------------------------
describe('sourceUrlToSkillMdRawUrl', () => {
  it('converts a GitHub URL to a raw SKILL.md URL', () => {
    expect(sourceUrlToSkillMdRawUrl('https://github.com/owner/repo')).toBe(
      'https://raw.githubusercontent.com/owner/repo/main/SKILL.md'
    );
  });

  it('includes nested path in the raw GitHub URL', () => {
    expect(sourceUrlToSkillMdRawUrl('https://github.com/owner/repo/tree/main/skills/web')).toBe(
      'https://raw.githubusercontent.com/owner/repo/main/skills/web/SKILL.md'
    );
  });

  it('converts a GitLab URL to a raw SKILL.md URL', () => {
    expect(sourceUrlToSkillMdRawUrl('https://gitlab.com/owner/repo')).toBe(
      'https://gitlab.com/owner/repo/-/raw/main/SKILL.md'
    );
  });

  it('passes through a direct .md URL unchanged', () => {
    const url = 'https://example.com/some/path/readme.md';
    expect(sourceUrlToSkillMdRawUrl(url)).toBe(url);
  });

  it('passes through a direct /SKILL.md URL unchanged', () => {
    const url = 'https://example.com/skills/SKILL.md';
    expect(sourceUrlToSkillMdRawUrl(url)).toBe(url);
  });

  it('uses sourceType override for an unknown domain', () => {
    expect(sourceUrlToSkillMdRawUrl('https://github.com/owner/repo', 'github')).toBe(
      'https://raw.githubusercontent.com/owner/repo/main/SKILL.md'
    );
  });

  it('returns null for an unknown format', () => {
    expect(sourceUrlToSkillMdRawUrl('https://example.com/some/path')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// extractDescriptionFromFrontmatter
// ---------------------------------------------------------------------------
describe('extractDescriptionFromFrontmatter', () => {
  it('extracts description from valid frontmatter', () => {
    const content = '---\ntitle: Hello\ndescription: A cool skill\n---\n# Body';
    expect(extractDescriptionFromFrontmatter(content)).toBe('A cool skill');
  });

  it('returns null when frontmatter has no description field', () => {
    const content = '---\ntitle: Hello\nauthor: Alice\n---\n# Body';
    expect(extractDescriptionFromFrontmatter(content)).toBeNull();
  });

  it('returns null when there is no frontmatter', () => {
    expect(extractDescriptionFromFrontmatter('# Just markdown')).toBeNull();
  });

  it('trims leading and trailing spaces from description', () => {
    const content = '---\ndescription:   spaced out   \n---\n';
    expect(extractDescriptionFromFrontmatter(content)).toBe('spaced out');
  });
});

// ---------------------------------------------------------------------------
// parseFrontmatter
// ---------------------------------------------------------------------------
describe('parseFrontmatter', () => {
  it('parses multiple key-value pairs', () => {
    const content = '---\ntitle: Hello\nauthor: Alice\nversion: 1.0\n---\n# Body';
    expect(parseFrontmatter(content)).toEqual({
      title: 'Hello',
      author: 'Alice',
      version: '1.0',
    });
  });

  it('returns an empty object for empty frontmatter', () => {
    const content = '---\n\n---\n# Body';
    expect(parseFrontmatter(content)).toEqual({});
  });

  it('returns an empty object when there is no frontmatter', () => {
    expect(parseFrontmatter('# Just markdown')).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// stripFrontmatter
// ---------------------------------------------------------------------------
describe('stripFrontmatter', () => {
  it('removes frontmatter and keeps content', () => {
    const content = '---\ntitle: Hello\n---\n# Body\nParagraph';
    expect(stripFrontmatter(content)).toBe('# Body\nParagraph');
  });

  it('returns content unchanged when there is no frontmatter', () => {
    const content = '# Just markdown\nParagraph';
    expect(stripFrontmatter(content)).toBe(content);
  });

  it('strips trailing newlines after frontmatter', () => {
    const content = '---\ntitle: Hello\n---\n\n\n# Body';
    expect(stripFrontmatter(content)).toBe('# Body');
  });
});
