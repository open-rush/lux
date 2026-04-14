import { McpRegistryService } from '@open-rush/control-plane';
import { getDbClient } from '@open-rush/db';

import { apiSuccess, requireAuth } from '@/lib/api-utils';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireAuth();
  const { id } = await params;

  const service = new McpRegistryService(getDbClient());
  const result = await service.toggleStar(id, userId);

  return apiSuccess(result);
}
