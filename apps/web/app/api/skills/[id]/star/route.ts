import { SkillRegistryService } from '@open-rush/control-plane';
import { getDbClient } from '@open-rush/db';

import { apiSuccess, requireAuth } from '@/lib/api-utils';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireAuth();
  const { id: name } = await params;

  const service = new SkillRegistryService(getDbClient());
  const result = await service.toggleStar(decodeURIComponent(name), userId);

  return apiSuccess(result);
}
