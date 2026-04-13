import { type DbClient, mcpServers } from '@lux/db';
import type { McpConfigStore, McpServerConfig, McpTransport } from '@lux/mcp';
import { and, eq, isNull } from 'drizzle-orm';

type McpRow = typeof mcpServers.$inferSelect;

function mapRow(row: McpRow): McpServerConfig {
  return {
    id: row.id,
    name: row.name,
    transport: row.transport as McpTransport,
    command: row.command ?? undefined,
    args: (row.args as string[] | null) ?? undefined,
    url: row.url ?? undefined,
    env: (row.env as Record<string, string> | null) ?? undefined,
    enabled: row.enabled,
    scope: row.scope as McpServerConfig['scope'],
  };
}

function scopeFilter(scope: string, scopeId?: string | null) {
  if (scopeId) {
    return and(eq(mcpServers.scope, scope), eq(mcpServers.scopeId, scopeId));
  }
  return and(eq(mcpServers.scope, scope), isNull(mcpServers.scopeId));
}

export class DrizzleMcpStore implements McpConfigStore {
  constructor(private db: DbClient) {}

  async getServers(scope: string, scopeId?: string): Promise<McpServerConfig[]> {
    const rows = await this.db
      .select()
      .from(mcpServers)
      .where(scopeFilter(scope, scopeId))
      .orderBy(mcpServers.name);
    return rows.map(mapRow);
  }

  async addServer(scope: string, scopeId: string | null, config: McpServerConfig): Promise<void> {
    await this.db.insert(mcpServers).values({
      id: config.id,
      scope,
      scopeId,
      name: config.name,
      transport: config.transport,
      command: config.command ?? null,
      args: config.args ?? null,
      url: config.url ?? null,
      env: config.env ?? null,
      enabled: config.enabled,
    });
  }

  async removeServer(scope: string, scopeId: string | null, serverId: string): Promise<boolean> {
    const rows = await this.db
      .delete(mcpServers)
      .where(and(eq(mcpServers.id, serverId), scopeFilter(scope, scopeId)))
      .returning();
    return rows.length > 0;
  }

  async updateServer(
    scope: string,
    scopeId: string | null,
    serverId: string,
    update: Partial<McpServerConfig>
  ): Promise<boolean> {
    const set: Partial<typeof mcpServers.$inferInsert> = {};
    if (update.name !== undefined) set.name = update.name;
    if (update.transport !== undefined) set.transport = update.transport;
    if (update.command !== undefined) set.command = update.command ?? null;
    if (update.args !== undefined) set.args = update.args ?? null;
    if (update.url !== undefined) set.url = update.url ?? null;
    if (update.env !== undefined) set.env = update.env ?? null;
    if (update.enabled !== undefined) set.enabled = update.enabled;
    set.updatedAt = new Date();

    const rows = await this.db
      .update(mcpServers)
      .set(set)
      .where(and(eq(mcpServers.id, serverId), scopeFilter(scope, scopeId)))
      .returning();
    return rows.length > 0;
  }
}
