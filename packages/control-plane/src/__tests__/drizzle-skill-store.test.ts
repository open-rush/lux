import { PGlite } from '@electric-sql/pglite';
import * as schema from '@lux/db';
import { projects, users } from '@lux/db';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DrizzleSkillStore } from '../skills/drizzle-skill-store.js';

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

let pglite: PGlite;
let db: TestDb;
let store: DrizzleSkillStore;
let projectId: string;

beforeAll(async () => {
  pglite = new PGlite();
  db = drizzle(pglite, { schema });

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT, email TEXT UNIQUE, email_verified_at TIMESTAMPTZ, image TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS projects (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(255) NOT NULL, description TEXT,
      sandbox_provider VARCHAR(50) NOT NULL DEFAULT 'opensandbox',
      default_model VARCHAR(255), default_connection_mode VARCHAR(50) DEFAULT 'anthropic',
      created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS skills (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      source TEXT NOT NULL,
      visibility VARCHAR(20) NOT NULL DEFAULT 'public',
      enabled BOOLEAN NOT NULL DEFAULT true,
      metadata TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(project_id, name)
    )
  `);

  const [user] = await db.insert(users).values({ name: 'test', email: 'skill@test.com' }).returning();
  const [project] = await db
    .insert(projects)
    .values({ name: 'Skill Test', createdBy: user.id })
    .returning();
  projectId = project.id;

  store = new DrizzleSkillStore(db as never);
});

beforeEach(async () => {
  await db.execute(sql`DELETE FROM skills`);
});

afterAll(async () => {
  await pglite.close();
});

describe('DrizzleSkillStore', () => {
  it('addSkill + getProjectSkills', async () => {
    await store.addSkill(projectId, {
      name: 'react-dev',
      source: '@kanyun/react-dev',
      visibility: 'public',
      enabled: true,
    });

    const skills = await store.getProjectSkills(projectId);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('react-dev');
    expect(skills[0].source).toBe('@kanyun/react-dev');
  });

  it('addSkill upserts on conflict', async () => {
    await store.addSkill(projectId, {
      name: 'react-dev',
      source: 'old-source',
      visibility: 'public',
      enabled: true,
    });
    await store.addSkill(projectId, {
      name: 'react-dev',
      source: 'new-source',
      visibility: 'private',
      enabled: false,
    });

    const skills = await store.getProjectSkills(projectId);
    expect(skills).toHaveLength(1);
    expect(skills[0].source).toBe('new-source');
    expect(skills[0].visibility).toBe('private');
    expect(skills[0].enabled).toBe(false);
  });

  it('removeSkill deletes and returns true', async () => {
    await store.addSkill(projectId, {
      name: 'to-remove',
      source: 'src',
      visibility: 'public',
      enabled: true,
    });

    expect(await store.removeSkill(projectId, 'to-remove')).toBe(true);
    expect(await store.getProjectSkills(projectId)).toHaveLength(0);
  });

  it('removeSkill returns false for missing', async () => {
    expect(await store.removeSkill(projectId, 'nope')).toBe(false);
  });

  it('updateSkill updates partial fields', async () => {
    await store.addSkill(projectId, {
      name: 'my-skill',
      source: 'src',
      visibility: 'public',
      enabled: true,
    });

    expect(await store.updateSkill(projectId, 'my-skill', { enabled: false })).toBe(true);

    const skills = await store.getProjectSkills(projectId);
    expect(skills[0].enabled).toBe(false);
    expect(skills[0].visibility).toBe('public'); // unchanged
  });

  it('getProjectSkills returns sorted by name', async () => {
    await store.addSkill(projectId, { name: 'z-skill', source: 'z', visibility: 'public', enabled: true });
    await store.addSkill(projectId, { name: 'a-skill', source: 'a', visibility: 'public', enabled: true });

    const skills = await store.getProjectSkills(projectId);
    expect(skills.map((s) => s.name)).toEqual(['a-skill', 'z-skill']);
  });
});
