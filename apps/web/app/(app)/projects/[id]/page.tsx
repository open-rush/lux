import { ArrowLeft, Settings } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/auth';
import { Button } from '@/components/ui/button';

async function getProject(id: string, userId: string) {
  const { DrizzleProjectDb, ProjectService, DbMembershipStore, DrizzleMembershipDb } = await import(
    '@rush/control-plane'
  );
  const { getDbClient } = await import('@rush/db');
  const db = getDbClient();
  const service = new ProjectService(new DrizzleProjectDb(db));
  const project = await service.getById(id);
  if (!project) return null;

  const store = new DbMembershipStore(new DrizzleMembershipDb(db));
  const membership = await store.getMembership(userId, id);
  if (!membership) return null;

  return project;
}

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  const { id } = await params;
  const project = await getProject(id, session.user.id);
  if (!project) notFound();

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/dashboard">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold truncate">{project.name}</h1>
          {project.description && (
            <p className="text-sm text-muted-foreground">{project.description}</p>
          )}
        </div>
        <Link href={`/projects/${id}/settings`}>
          <Button variant="outline" size="sm">
            <Settings className="mr-2 h-4 w-4" />
            Settings
          </Button>
        </Link>
      </div>

      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-muted-foreground">Start a conversation to begin building with AI.</p>
      </div>
    </div>
  );
}
