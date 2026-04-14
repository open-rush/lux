import { PGlite } from '@electric-sql/pglite';
import * as schema from '@open-rush/db';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DrizzleMcpStore } from '../mcp/drizzle-mcp-store.js';

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

let pglite: PGlite;
let db: TestDb;
let store: DrizzleMcpStore;

beforeAll(async () => {
  pglite = new PGlite();
  db = drizzle(pglite, { schema });

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS mcp_servers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      scope VARCHAR(20) NOT NULL,
      scope_id UUID,
      name VARCHAR(255) NOT NULL,
      transport VARCHAR(20) NOT NULL,
      command TEXT,
      args JSONB,
      url TEXT,
      env JSONB,
      enabled BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  store = new DrizzleMcpStore(db as never);
});

beforeEach(async () => {
  await db.execute(sql`DELETE FROM mcp_servers`);
});

afterAll(async () => {
  await pglite.close();
});

const projectId = '00000000-0000-0000-0000-000000000001';

describe('DrizzleMcpStore', () => {
  it('addServer + getServers', async () => {
    await store.addServer('project', projectId, {
      id: '11111111-1111-1111-1111-111111111111',
      name: 'test-mcp',
      transport: 'stdio',
      command: 'node',
      args: ['server.js'],
      enabled: true,
      scope: 'project',
    });

    const servers = await store.getServers('project', projectId);
    expect(servers).toHaveLength(1);
    expect(servers[0].name).toBe('test-mcp');
    expect(servers[0].transport).toBe('stdio');
    expect(servers[0].command).toBe('node');
    expect(servers[0].args).toEqual(['server.js']);
  });

  it('removeServer deletes and returns true', async () => {
    const id = '22222222-2222-2222-2222-222222222222';
    await store.addServer('project', projectId, {
      id,
      name: 'to-remove',
      transport: 'sse',
      url: 'http://localhost:3001',
      enabled: true,
      scope: 'project',
    });

    expect(await store.removeServer('project', projectId, id)).toBe(true);
    expect(await store.getServers('project', projectId)).toHaveLength(0);
  });

  it('removeServer returns false for missing', async () => {
    expect(
      await store.removeServer('project', projectId, '99999999-9999-9999-9999-999999999999')
    ).toBe(false);
  });

  it('updateServer updates partial fields', async () => {
    const id = '33333333-3333-3333-3333-333333333333';
    await store.addServer('project', projectId, {
      id,
      name: 'updatable',
      transport: 'stdio',
      command: 'old-cmd',
      enabled: true,
      scope: 'project',
    });

    expect(
      await store.updateServer('project', projectId, id, { enabled: false, command: 'new-cmd' })
    ).toBe(true);

    const [server] = await store.getServers('project', projectId);
    expect(server.enabled).toBe(false);
    expect(server.command).toBe('new-cmd');
    expect(server.name).toBe('updatable');
  });

  it('getServers returns sorted by name', async () => {
    await store.addServer('project', projectId, {
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      name: 'z-server',
      transport: 'stdio',
      enabled: true,
      scope: 'project',
    });
    await store.addServer('project', projectId, {
      id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      name: 'a-server',
      transport: 'sse',
      url: 'http://x',
      enabled: true,
      scope: 'project',
    });

    const servers = await store.getServers('project', projectId);
    expect(servers.map((s) => s.name)).toEqual(['a-server', 'z-server']);
  });

  it('global scope servers have null scopeId', async () => {
    await store.addServer('global', null, {
      id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      name: 'global-mcp',
      transport: 'stdio',
      command: 'global-cmd',
      enabled: true,
      scope: 'global',
    });

    const servers = await store.getServers('global');
    expect(servers).toHaveLength(1);
    expect(servers[0].name).toBe('global-mcp');
  });
});
