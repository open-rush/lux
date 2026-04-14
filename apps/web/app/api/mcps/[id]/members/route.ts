import { McpRegistryService } from '@open-rush/control-plane';
import { getDbClient } from '@open-rush/db';

import { apiError, apiSuccess, requireAuth } from '@/lib/api-utils';

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireAuth();
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body) return apiError(400, 'INVALID_INPUT', 'Invalid JSON body');

  if (!Array.isArray(body.members)) {
    return apiError(400, 'INVALID_INPUT', 'members must be an array');
  }

  const service = new McpRegistryService(getDbClient());
  const role = await service.checkWriteAccess(id, userId);
  if (role !== 'owner') return apiError(403, 'FORBIDDEN', 'Only the owner can manage members');

  await service.updateMembers(id, body.members);

  return apiSuccess({ updated: true });
}
