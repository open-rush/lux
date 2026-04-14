import { McpRegistryService } from '@open-rush/control-plane';
import { getDbClient } from '@open-rush/db';

import { apiSuccess, requireAuth } from '@/lib/api-utils';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireAuth();
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const service = new McpRegistryService(getDbClient());
  await service.install(id, userId, body.userConfig);

  return apiSuccess({ installed: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireAuth();
  const { id } = await params;

  const service = new McpRegistryService(getDbClient());
  await service.uninstall(id, userId);

  return apiSuccess({ uninstalled: true });
}
