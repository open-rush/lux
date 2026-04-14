import { SkillRegistryService } from '@open-rush/control-plane';
import { getDbClient } from '@open-rush/db';

import { apiError, apiSuccess, requireAuth } from '@/lib/api-utils';

export async function GET() {
  await requireAuth();
  const service = new SkillRegistryService(getDbClient());
  const groups = await service.listGroups();
  return apiSuccess(groups);
}

export async function POST(req: Request) {
  const userId = await requireAuth();
  const body = await req.json().catch(() => null);
  if (!body) return apiError(400, 'INVALID_INPUT', 'Invalid JSON body');

  if (!body.name?.trim() || !body.slug?.trim()) {
    return apiError(400, 'INVALID_INPUT', 'name and slug are required');
  }

  const service = new SkillRegistryService(getDbClient());
  const group = await service.createGroup({
    name: body.name,
    slug: body.slug,
    description: body.description,
    visibility: body.visibility,
    createdById: userId,
  });

  return apiSuccess(group, 201);
}
