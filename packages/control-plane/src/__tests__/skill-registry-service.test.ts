/**
 * SkillRegistryService 单元测试
 *
 * 使用 PGlite 内存数据库测试 CRUD + Star + Groups
 */

import { PGlite } from '@electric-sql/pglite';
import * as schema from '@open-rush/db';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SkillRegistryService } from '../skills/skill-registry-service.js';

let pg: PGlite;
let db: ReturnType<typeof drizzle>;
let service: SkillRegistryService;
let userId: string;

beforeAll(async () => {
  pg = new PGlite();
  db = drizzle(pg, { schema });

  // Create tables
  await pg.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT, email TEXT UNIQUE, email_verified_at TIMESTAMPTZ, image TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS skill_registry (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(255) NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      source_type VARCHAR(20) NOT NULL DEFAULT 'registry',
      source_url TEXT,
      category VARCHAR(50),
      tags JSONB NOT NULL DEFAULT '[]',
      visibility VARCHAR(20) NOT NULL DEFAULT 'public',
      latest_version VARCHAR(50),
      skill_md_content TEXT,
      license VARCHAR(50),
      allowed_tools TEXT,
      star_count INTEGER NOT NULL DEFAULT 0,
      install_count INTEGER NOT NULL DEFAULT 0,
      created_by_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      members JSONB NOT NULL DEFAULT '[]',
      group_id UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS skill_stars (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      skill_name VARCHAR(255) NOT NULL,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(skill_name, user_id)
    );
    CREATE TABLE IF NOT EXISTS skill_groups (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(255) NOT NULL,
      slug VARCHAR(255) NOT NULL UNIQUE,
      description TEXT,
      visibility VARCHAR(20) NOT NULL DEFAULT 'public',
      parent_id UUID,
      created_by_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // Create test user
  const [user] = await db
    .insert(schema.users)
    .values({
      name: 'Test User',
      email: 'test@example.com',
    })
    .returning();
  userId = user.id;

  service = new SkillRegistryService(db as never);
});

beforeEach(async () => {
  await pg.exec('DELETE FROM skill_stars');
  await pg.exec('DELETE FROM skill_registry');
  await pg.exec('DELETE FROM skill_groups');
});

afterAll(async () => {
  await pg.close();
});

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

describe('CRUD', () => {
  it('creates and retrieves a skill', async () => {
    const skill = await service.create({
      name: '@openrush/test-skill',
      description: 'A test skill',
      createdById: userId,
    });
    expect(skill.name).toBe('@openrush/test-skill');
    expect(skill.description).toBe('A test skill');

    const retrieved = await service.getByName('@openrush/test-skill');
    expect(retrieved).not.toBeNull();
    expect(retrieved?.name).toBe('@openrush/test-skill');
  });

  it('lists skills with search', async () => {
    await service.create({
      name: '@openrush/alpha',
      description: 'Alpha skill',
      createdById: userId,
    });
    await service.create({
      name: '@openrush/beta',
      description: 'Beta skill',
      createdById: userId,
    });

    const all = await service.list();
    expect(all.total).toBe(2);

    const searched = await service.list({ search: 'alpha' });
    expect(searched.total).toBe(1);
    expect(searched.items[0].name).toBe('@openrush/alpha');
  });

  it('updates a skill', async () => {
    await service.create({ name: '@openrush/to-update', description: 'Old', createdById: userId });
    const updated = await service.update('@openrush/to-update', { description: 'New description' });
    expect(updated?.description).toBe('New description');
  });

  it('deletes a skill', async () => {
    await service.create({
      name: '@openrush/to-delete',
      description: 'Delete me',
      createdById: userId,
    });
    const deleted = await service.remove('@openrush/to-delete');
    expect(deleted).toBe(true);

    const retrieved = await service.getByName('@openrush/to-delete');
    expect(retrieved).toBeNull();
  });

  it('stores and retrieves skillMdContent', async () => {
    await service.create({
      name: '@openrush/with-md',
      description: 'Has markdown',
      skillMdContent: '# Hello\n\nThis is a skill.',
      createdById: userId,
    });
    const skill = await service.getByName('@openrush/with-md');
    expect(skill?.skillMdContent).toBe('# Hello\n\nThis is a skill.');
  });
});

// ---------------------------------------------------------------------------
// Star
// ---------------------------------------------------------------------------

describe('Star', () => {
  it('toggles star on and off', async () => {
    await service.create({ name: '@openrush/star-test', description: '', createdById: userId });

    const on = await service.toggleStar('@openrush/star-test', userId);
    expect(on.starred).toBe(true);
    expect(on.starCount).toBe(1);

    const off = await service.toggleStar('@openrush/star-test', userId);
    expect(off.starred).toBe(false);
    expect(off.starCount).toBe(0);
  });

  it('reports isStarred in getByName', async () => {
    await service.create({ name: '@openrush/star-check', description: '', createdById: userId });
    await service.toggleStar('@openrush/star-check', userId);

    const skill = await service.getByName('@openrush/star-check', userId);
    expect(skill?.isStarred).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

describe('Groups', () => {
  it('creates and lists groups', async () => {
    await service.createGroup({ name: 'Frontend', slug: 'frontend', createdById: userId });
    await service.createGroup({ name: 'Backend', slug: 'backend', createdById: userId });

    const groups = await service.listGroups();
    expect(groups).toHaveLength(2);
  });

  it('deletes a group', async () => {
    const group = await service.createGroup({ name: 'Temp', slug: 'temp', createdById: userId });
    const deleted = await service.deleteGroup(group.id);
    expect(deleted).toBe(true);

    const groups = await service.listGroups();
    expect(groups).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Pagination & Sorting
// ---------------------------------------------------------------------------

describe('Pagination', () => {
  it('respects limit and offset', async () => {
    for (let i = 0; i < 5; i++) {
      await service.create({
        name: `@openrush/page-${i}`,
        description: `Skill ${i}`,
        createdById: userId,
      });
    }

    const page1 = await service.list({ limit: 2, offset: 0 });
    expect(page1.items).toHaveLength(2);
    expect(page1.total).toBe(5);

    const page2 = await service.list({ limit: 2, offset: 2 });
    expect(page2.items).toHaveLength(2);
  });
});
