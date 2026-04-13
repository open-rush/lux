import { abortStream } from '@/lib/ai/stream-abort-registry';
import { requireAuth } from '@/lib/api-utils';

export async function POST(req: Request) {
  try {
    await requireAuth();
  } catch (res) {
    return res as Response;
  }

  const { projectId } = await req.json();

  if (!projectId || typeof projectId !== 'string') {
    return Response.json({ error: 'projectId is required' }, { status: 400 });
  }

  const aborted = abortStream(projectId);
  return Response.json({ aborted });
}
