import { SkillRegistryService } from '@open-rush/control-plane';
import { getDbClient } from '@open-rush/db';

import { apiError, apiSuccess, requireAuth } from '@/lib/api-utils';

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireAuth();
  const { id: name } = await params;
  const decodedName = decodeURIComponent(name);
  const body = await req.json().catch(() => null);
  if (!body) return apiError(400, 'INVALID_INPUT', 'Invalid JSON body');

  if (!Array.isArray(body.members)) {
    return apiError(400, 'INVALID_INPUT', 'members must be an array');
  }

  const service = new SkillRegistryService(getDbClient());
  const role = await service.checkWriteAccess(decodedName, userId);
  if (role !== 'owner') return apiError(403, 'FORBIDDEN', 'Only the owner can manage members');

  await service.updateMembers(decodedName, body.members);

  return apiSuccess({ updated: true });
}
