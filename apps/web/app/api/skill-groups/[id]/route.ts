import { SkillRegistryService } from '@open-rush/control-plane';
import { getDbClient } from '@open-rush/db';

import { apiError, apiSuccess, requireAuth } from '@/lib/api-utils';

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireAuth();
  const { id } = await params;

  const service = new SkillRegistryService(getDbClient());
  const deleted = await service.deleteGroup(id);
  if (!deleted) return apiError(404, 'NOT_FOUND', 'Group not found');

  return apiSuccess({ deleted: true });
}
