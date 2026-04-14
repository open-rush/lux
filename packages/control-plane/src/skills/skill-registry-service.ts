/**
 * Skill Registry Service — 全局 Skill 市场 CRUD + Star + Members
 */

import { type DbClient, skillGroups, skillRegistry, skillStars } from '@open-rush/db';
import { and, count, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SkillRegistryItem {
  id: string;
  name: string;
  description: string;
  sourceType: string;
  sourceUrl: string | null;
  category: string | null;
  tags: string[];
  visibility: string;
  latestVersion: string | null;
  skillMdContent: string | null;
  license: string | null;
  starCount: number;
  installCount: number;
  createdById: string;
  members: string[];
  groupId: string | null;
  createdAt: Date;
  updatedAt: Date;
  isStarred?: boolean;
}

export interface CreateSkillInput {
  name: string;
  description: string;
  sourceType?: string;
  sourceUrl?: string;
  category?: string;
  tags?: string[];
  visibility?: string;
  skillMdContent?: string;
  license?: string;
  createdById: string;
  groupId?: string;
}

export interface SkillListOptions {
  search?: string;
  category?: string;
  visibility?: string;
  sortBy?: 'updated_at' | 'star_count' | 'install_count' | 'name';
  limit?: number;
  offset?: number;
  userId?: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class SkillRegistryService {
  constructor(private db: DbClient) {}

  async list(
    options: SkillListOptions = {}
  ): Promise<{ items: SkillRegistryItem[]; total: number }> {
    const {
      search,
      category,
      visibility,
      sortBy = 'updated_at',
      limit = 20,
      offset = 0,
      userId,
    } = options;

    const conditions = [];
    if (search) {
      conditions.push(
        or(
          ilike(skillRegistry.name, `%${search}%`),
          ilike(skillRegistry.description, `%${search}%`)
        )
      );
    }
    if (category && category !== 'all') {
      conditions.push(eq(skillRegistry.category, category));
    }
    if (visibility && visibility !== 'all') {
      conditions.push(eq(skillRegistry.visibility, visibility));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const orderMap = {
      updated_at: desc(skillRegistry.updatedAt),
      star_count: desc(skillRegistry.starCount),
      install_count: desc(skillRegistry.installCount),
      name: skillRegistry.name,
    } as const;

    const [rows, [countResult]] = await Promise.all([
      this.db
        .select()
        .from(skillRegistry)
        .where(where)
        .orderBy(orderMap[sortBy])
        .limit(limit)
        .offset(offset),
      this.db.select({ value: count() }).from(skillRegistry).where(where),
    ]);

    let starredSet = new Set<string>();
    if (userId && rows.length > 0) {
      const names = rows.map((r) => r.name);
      const stars = await this.db
        .select({ skillName: skillStars.skillName })
        .from(skillStars)
        .where(and(eq(skillStars.userId, userId), inArray(skillStars.skillName, names)));
      starredSet = new Set(stars.map((s) => s.skillName));
    }

    return {
      items: rows.map((r) => ({
        ...this.mapRow(r),
        isStarred: starredSet.has(r.name),
      })),
      total: countResult?.value ?? 0,
    };
  }

  async getByName(name: string, userId?: string): Promise<SkillRegistryItem | null> {
    const [row] = await this.db
      .select()
      .from(skillRegistry)
      .where(eq(skillRegistry.name, name))
      .limit(1);
    if (!row) return null;

    let isStarred = false;
    if (userId) {
      const [star] = await this.db
        .select()
        .from(skillStars)
        .where(and(eq(skillStars.skillName, name), eq(skillStars.userId, userId)))
        .limit(1);
      isStarred = !!star;
    }

    return { ...this.mapRow(row), isStarred };
  }

  async create(input: CreateSkillInput): Promise<SkillRegistryItem> {
    const [row] = await this.db
      .insert(skillRegistry)
      .values({
        name: input.name,
        description: input.description,
        sourceType: input.sourceType ?? 'registry',
        sourceUrl: input.sourceUrl,
        category: input.category,
        tags: input.tags ?? [],
        visibility: input.visibility ?? 'public',
        skillMdContent: input.skillMdContent,
        license: input.license,
        createdById: input.createdById,
        groupId: input.groupId,
      })
      .returning();
    return this.mapRow(row);
  }

  async update(
    name: string,
    update: Partial<Omit<CreateSkillInput, 'name' | 'createdById'>>
  ): Promise<SkillRegistryItem | null> {
    const values: Record<string, unknown> = { updatedAt: new Date() };
    if (update.description !== undefined) values.description = update.description;
    if (update.sourceType !== undefined) values.sourceType = update.sourceType;
    if (update.sourceUrl !== undefined) values.sourceUrl = update.sourceUrl;
    if (update.category !== undefined) values.category = update.category;
    if (update.tags !== undefined) values.tags = update.tags;
    if (update.visibility !== undefined) values.visibility = update.visibility;
    if (update.skillMdContent !== undefined) values.skillMdContent = update.skillMdContent;
    if (update.license !== undefined) values.license = update.license;
    if (update.groupId !== undefined) values.groupId = update.groupId;

    const [row] = await this.db
      .update(skillRegistry)
      .set(values)
      .where(eq(skillRegistry.name, name))
      .returning();
    return row ? this.mapRow(row) : null;
  }

  async remove(name: string): Promise<boolean> {
    const rows = await this.db
      .delete(skillRegistry)
      .where(eq(skillRegistry.name, name))
      .returning();
    return rows.length > 0;
  }

  // Star -------------------------------------------------------------------

  async toggleStar(
    skillName: string,
    userId: string
  ): Promise<{ starred: boolean; starCount: number }> {
    const [existing] = await this.db
      .select()
      .from(skillStars)
      .where(and(eq(skillStars.skillName, skillName), eq(skillStars.userId, userId)))
      .limit(1);

    if (existing) {
      await this.db
        .delete(skillStars)
        .where(and(eq(skillStars.skillName, skillName), eq(skillStars.userId, userId)));
      await this.db
        .update(skillRegistry)
        .set({ starCount: sql`GREATEST(${skillRegistry.starCount} - 1, 0)` })
        .where(eq(skillRegistry.name, skillName));
    } else {
      await this.db.insert(skillStars).values({ skillName, userId });
      await this.db
        .update(skillRegistry)
        .set({ starCount: sql`${skillRegistry.starCount} + 1` })
        .where(eq(skillRegistry.name, skillName));
    }

    const [row] = await this.db
      .select({ starCount: skillRegistry.starCount })
      .from(skillRegistry)
      .where(eq(skillRegistry.name, skillName))
      .limit(1);

    return { starred: !existing, starCount: row?.starCount ?? 0 };
  }

  // Members ----------------------------------------------------------------

  async updateMembers(name: string, members: string[]): Promise<void> {
    await this.db
      .update(skillRegistry)
      .set({ members, updatedAt: new Date() })
      .where(eq(skillRegistry.name, name));
  }

  // Groups -----------------------------------------------------------------

  async listGroups(): Promise<
    Array<{
      id: string;
      name: string;
      slug: string;
      description: string | null;
      visibility: string;
      createdAt: Date;
    }>
  > {
    return this.db.select().from(skillGroups).orderBy(skillGroups.name);
  }

  async createGroup(input: {
    name: string;
    slug: string;
    description?: string;
    visibility?: string;
    createdById: string;
  }): Promise<{ id: string; name: string; slug: string }> {
    const [row] = await this.db
      .insert(skillGroups)
      .values({
        name: input.name,
        slug: input.slug,
        description: input.description,
        visibility: input.visibility ?? 'public',
        createdById: input.createdById,
      })
      .returning();
    return { id: row.id, name: row.name, slug: row.slug };
  }

  async deleteGroup(id: string): Promise<boolean> {
    const rows = await this.db.delete(skillGroups).where(eq(skillGroups.id, id)).returning();
    return rows.length > 0;
  }

  // Permissions -------------------------------------------------------------

  /** Check if user can write (update/delete) a skill. Returns role or null. */
  async checkWriteAccess(name: string, userId: string): Promise<'owner' | 'collaborator' | null> {
    const [row] = await this.db
      .select({ createdById: skillRegistry.createdById, members: skillRegistry.members })
      .from(skillRegistry)
      .where(eq(skillRegistry.name, name))
      .limit(1);
    if (!row) return null;
    if (row.createdById === userId) return 'owner';
    if ((row.members as string[])?.includes(userId)) return 'collaborator';
    return null;
  }

  // Helpers ----------------------------------------------------------------

  private mapRow(row: typeof skillRegistry.$inferSelect): SkillRegistryItem {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      sourceType: row.sourceType,
      sourceUrl: row.sourceUrl,
      category: row.category,
      tags: (row.tags as string[]) ?? [],
      visibility: row.visibility,
      latestVersion: row.latestVersion,
      skillMdContent: row.skillMdContent,
      license: row.license,
      starCount: row.starCount,
      installCount: row.installCount,
      createdById: row.createdById,
      members: (row.members as string[]) ?? [],
      groupId: row.groupId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
