import { CreateRunRequest } from '@rush/contracts';
import { DrizzleRunDb, RunService } from '@rush/control-plane';
import { agents, getDbClient, projects } from '@rush/db';
import { and, eq } from 'drizzle-orm';

import { apiError, apiSuccess, requireAuth, verifyProjectAccess } from '@/lib/api-utils';
import { getQueue } from '@/lib/queue';

export async function POST(request: Request) {
  let userId: string;
  try {
    userId = await requireAuth();
  } catch (res) {
    return res as Response;
  }

  // Parse & validate body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, 'VALIDATION_ERROR', 'Invalid JSON body');
  }

  const parsed = CreateRunRequest.safeParse(body);
  if (!parsed.success) {
    return apiError(400, 'VALIDATION_ERROR', parsed.error.issues[0].message);
  }

  const { prompt, projectId, connectionMode, model, triggerSource } = parsed.data;
  let { agentId } = parsed.data;

  // Verify project exists and user has access
  const db = getDbClient();
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) {
    return apiError(404, 'PROJECT_NOT_FOUND', `Project ${projectId} not found`);
  }
  const hasAccess = await verifyProjectAccess(projectId, userId);
  if (!hasAccess) {
    return apiError(403, 'FORBIDDEN', 'No access to this project');
  }

  // Validate agentId belongs to this project if provided
  let isNewAgent = false;
  if (agentId) {
    const [existingAgent] = await db
      .select()
      .from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.projectId, projectId)))
      .limit(1);
    if (!existingAgent) {
      return apiError(400, 'INVALID_AGENT', 'Agent does not belong to this project');
    }
  } else {
    const [newAgent] = await db
      .insert(agents)
      .values({
        projectId,
        createdBy: userId,
      })
      .returning();
    agentId = newAgent.id;
    isNewAgent = true;
  }

  // Create Run in DB
  const runDb = new DrizzleRunDb(db);
  const runService = new RunService(runDb);
  const run = await runService.createRun({
    agentId,
    prompt,
    connectionMode: connectionMode ?? undefined,
    modelId: model ?? undefined,
    triggerSource: triggerSource ?? undefined,
  });

  // Enqueue pg-boss job
  const queue = await getQueue();
  await queue.send('run:execute', {
    runId: run.id,
    prompt,
    agentId,
  });

  return apiSuccess({ runId: run.id, agentId, isNewAgent }, 201);
}
