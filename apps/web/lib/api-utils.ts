import { getDbClient, projectMembers, projects } from '@rush/db';
import { and, eq } from 'drizzle-orm';

import { auth } from '@/auth';

/**
 * Require authenticated session. Returns userId or throws 401 Response.
 */
export async function requireAuth(): Promise<string> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    throw Response.json(
      { success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' },
      { status: 401 }
    );
  }
  return userId;
}

/**
 * Verify user has access to a project (is creator or member).
 * Returns true if user has access, false otherwise.
 */
export async function verifyProjectAccess(projectId: string, userId: string): Promise<boolean> {
  const db = getDbClient();

  // Check if user is project creator
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.createdBy, userId)))
    .limit(1);

  if (project) return true;

  // Check if user is a project member
  const [membership] = await db
    .select({ id: projectMembers.id })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
    .limit(1);

  return !!membership;
}

/**
 * Standard API error response.
 */
export function apiError(status: number, code: string, message: string): Response {
  return Response.json({ success: false, error: message, code }, { status });
}

/**
 * Standard API success response.
 */
export function apiSuccess(data: unknown, status = 200): Response {
  return Response.json({ success: true, data }, { status });
}
