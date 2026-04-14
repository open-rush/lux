/**
 * MCP Registry Service — 全局 MCP 注册中心 CRUD + Star + Install
 */

import { type DbClient, mcpRegistry, mcpStars, mcpUserInstalls } from '@open-rush/db';
import { and, count, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface McpRegistryItem {
  id: string;
  name: string;
  displayName: string;
  description: string;
  transportType: string;
  serverConfig: Record<string, unknown>;
  tools: Array<{ name: string; description: string }>;
  tags: string[];
  category: string | null;
  author: string | null;
  extraConfig: Record<string, string> | null;
  extraConfigMeta: Record<string, { helpUrl?: string; type?: string }> | null;
  docUrl: string | null;
  repoUrl: string | null;
  readme: string | null;
  starCount: number;
  isBuiltin: boolean;
  visibility: string;
  source: string | null;
  createdById: string;
  members: string[];
  createdAt: Date;
  updatedAt: Date;
  isStarred?: boolean;
  isInstalled?: boolean;
}

export interface CreateMcpInput {
  name: string;
  displayName: string;
  description: string;
  transportType: string;
  serverConfig: Record<string, unknown>;
  tools?: Array<{ name: string; description: string }>;
  tags?: string[];
  category?: string;
  author?: string;
  extraConfig?: Record<string, string>;
  extraConfigMeta?: Record<string, { helpUrl?: string; type?: string }>;
  docUrl?: string;
  repoUrl?: string;
  readme?: string;
  visibility?: string;
  createdById: string;
}

export interface McpListOptions {
  search?: string;
  transportType?: string;
  category?: string;
  source?: string;
  sortBy?: 'updated_at' | 'star_count' | 'name' | 'created_at';
  limit?: number;
  offset?: number;
  userId?: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class McpRegistryService {
  constructor(private db: DbClient) {}

  async list(options: McpListOptions = {}): Promise<{ items: McpRegistryItem[]; total: number }> {
    const {
      search,
      transportType,
      category,
      source,
      sortBy = 'updated_at',
      limit = 20,
      offset = 0,
      userId,
    } = options;

    const conditions = [];
    if (search) {
      conditions.push(
        or(
          ilike(mcpRegistry.name, `%${search}%`),
          ilike(mcpRegistry.displayName, `%${search}%`),
          ilike(mcpRegistry.description, `%${search}%`)
        )
      );
    }
    if (transportType && transportType !== 'all') {
      conditions.push(eq(mcpRegistry.transportType, transportType));
    }
    if (category && category !== 'all') {
      conditions.push(eq(mcpRegistry.category, category));
    }
    if (source && source !== 'all') {
      conditions.push(eq(mcpRegistry.source, source));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const orderMap = {
      updated_at: desc(mcpRegistry.updatedAt),
      star_count: desc(mcpRegistry.starCount),
      name: mcpRegistry.name,
      created_at: desc(mcpRegistry.createdAt),
    } as const;

    const [rows, [countResult]] = await Promise.all([
      this.db
        .select()
        .from(mcpRegistry)
        .where(where)
        .orderBy(orderMap[sortBy])
        .limit(limit)
        .offset(offset),
      this.db.select({ value: count() }).from(mcpRegistry).where(where),
    ]);

    let starredSet = new Set<string>();
    let installedSet = new Set<string>();
    if (userId && rows.length > 0) {
      const ids = rows.map((r) => r.id);
      const [stars, installs] = await Promise.all([
        this.db
          .select({ mcpId: mcpStars.mcpId })
          .from(mcpStars)
          .where(and(eq(mcpStars.userId, userId), inArray(mcpStars.mcpId, ids))),
        this.db
          .select({ mcpId: mcpUserInstalls.mcpId })
          .from(mcpUserInstalls)
          .where(and(eq(mcpUserInstalls.userId, userId), inArray(mcpUserInstalls.mcpId, ids))),
      ]);
      starredSet = new Set(stars.map((s) => s.mcpId));
      installedSet = new Set(installs.map((i) => i.mcpId));
    }

    return {
      items: rows.map((r) => ({
        ...this.mapRow(r),
        isStarred: starredSet.has(r.id),
        isInstalled: installedSet.has(r.id),
      })),
      total: countResult?.value ?? 0,
    };
  }

  async getById(id: string, userId?: string): Promise<McpRegistryItem | null> {
    const [row] = await this.db.select().from(mcpRegistry).where(eq(mcpRegistry.id, id)).limit(1);
    if (!row) return null;

    let isStarred = false;
    let isInstalled = false;
    if (userId) {
      const [[star], [install]] = await Promise.all([
        this.db
          .select()
          .from(mcpStars)
          .where(and(eq(mcpStars.mcpId, id), eq(mcpStars.userId, userId)))
          .limit(1),
        this.db
          .select()
          .from(mcpUserInstalls)
          .where(and(eq(mcpUserInstalls.mcpId, id), eq(mcpUserInstalls.userId, userId)))
          .limit(1),
      ]);
      isStarred = !!star;
      isInstalled = !!install;
    }

    return { ...this.mapRow(row), isStarred, isInstalled };
  }

  async create(input: CreateMcpInput): Promise<McpRegistryItem> {
    const [row] = await this.db
      .insert(mcpRegistry)
      .values({
        name: input.name,
        displayName: input.displayName,
        description: input.description,
        transportType: input.transportType,
        serverConfig: input.serverConfig,
        tools: input.tools ?? [],
        tags: input.tags ?? [],
        category: input.category ?? 'utilities',
        author: input.author,
        extraConfig: input.extraConfig,
        extraConfigMeta: input.extraConfigMeta,
        docUrl: input.docUrl,
        repoUrl: input.repoUrl,
        readme: input.readme,
        visibility: input.visibility ?? 'public',
        createdById: input.createdById,
      })
      .returning();
    return this.mapRow(row);
  }

  async update(
    id: string,
    update: Partial<Omit<CreateMcpInput, 'name' | 'createdById'>>
  ): Promise<McpRegistryItem | null> {
    const values: Record<string, unknown> = { updatedAt: new Date() };
    for (const [key, val] of Object.entries(update)) {
      if (val !== undefined) values[key] = val;
    }
    const [row] = await this.db
      .update(mcpRegistry)
      .set(values)
      .where(eq(mcpRegistry.id, id))
      .returning();
    return row ? this.mapRow(row) : null;
  }

  async remove(id: string): Promise<boolean> {
    const rows = await this.db.delete(mcpRegistry).where(eq(mcpRegistry.id, id)).returning();
    return rows.length > 0;
  }

  // Star -------------------------------------------------------------------

  async toggleStar(
    mcpId: string,
    userId: string
  ): Promise<{ starred: boolean; starCount: number }> {
    const [existing] = await this.db
      .select()
      .from(mcpStars)
      .where(and(eq(mcpStars.mcpId, mcpId), eq(mcpStars.userId, userId)))
      .limit(1);

    if (existing) {
      await this.db
        .delete(mcpStars)
        .where(and(eq(mcpStars.mcpId, mcpId), eq(mcpStars.userId, userId)));
      await this.db
        .update(mcpRegistry)
        .set({ starCount: sql`GREATEST(${mcpRegistry.starCount} - 1, 0)` })
        .where(eq(mcpRegistry.id, mcpId));
    } else {
      await this.db.insert(mcpStars).values({ mcpId, userId });
      await this.db
        .update(mcpRegistry)
        .set({ starCount: sql`${mcpRegistry.starCount} + 1` })
        .where(eq(mcpRegistry.id, mcpId));
    }

    const [row] = await this.db
      .select({ starCount: mcpRegistry.starCount })
      .from(mcpRegistry)
      .where(eq(mcpRegistry.id, mcpId))
      .limit(1);
    return { starred: !existing, starCount: row?.starCount ?? 0 };
  }

  // Install / Uninstall ----------------------------------------------------

  async install(mcpId: string, userId: string, userConfig?: Record<string, string>): Promise<void> {
    await this.db
      .insert(mcpUserInstalls)
      .values({ mcpId, userId, userConfig })
      .onConflictDoUpdate({
        target: [mcpUserInstalls.mcpId, mcpUserInstalls.userId],
        set: { userConfig: userConfig ?? null },
      });
  }

  async uninstall(mcpId: string, userId: string): Promise<void> {
    await this.db
      .delete(mcpUserInstalls)
      .where(and(eq(mcpUserInstalls.mcpId, mcpId), eq(mcpUserInstalls.userId, userId)));
  }

  // Members ----------------------------------------------------------------

  async updateMembers(id: string, members: string[]): Promise<void> {
    await this.db
      .update(mcpRegistry)
      .set({ members, updatedAt: new Date() })
      .where(eq(mcpRegistry.id, id));
  }

  // Permissions -------------------------------------------------------------

  async checkWriteAccess(id: string, userId: string): Promise<'owner' | 'collaborator' | null> {
    const [row] = await this.db
      .select({ createdById: mcpRegistry.createdById, members: mcpRegistry.members })
      .from(mcpRegistry)
      .where(eq(mcpRegistry.id, id))
      .limit(1);
    if (!row) return null;
    if (row.createdById === userId) return 'owner';
    if ((row.members as string[])?.includes(userId)) return 'collaborator';
    return null;
  }

  // Helpers ----------------------------------------------------------------

  private mapRow(row: typeof mcpRegistry.$inferSelect): McpRegistryItem {
    return {
      id: row.id,
      name: row.name,
      displayName: row.displayName,
      description: row.description,
      transportType: row.transportType,
      serverConfig: (row.serverConfig as Record<string, unknown>) ?? {},
      tools: (row.tools as Array<{ name: string; description: string }>) ?? [],
      tags: (row.tags as string[]) ?? [],
      category: row.category,
      author: row.author,
      extraConfig: row.extraConfig as Record<string, string> | null,
      extraConfigMeta: row.extraConfigMeta as Record<
        string,
        { helpUrl?: string; type?: string }
      > | null,
      docUrl: row.docUrl,
      repoUrl: row.repoUrl,
      readme: row.readme,
      starCount: row.starCount,
      isBuiltin: row.isBuiltin,
      visibility: row.visibility,
      source: row.source,
      createdById: row.createdById,
      members: (row.members as string[]) ?? [],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
