'use client';

import { Sidebar } from './sidebar';

interface AppShellUser {
  id?: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
}

interface ProjectItem {
  id: string;
  name: string;
}

interface AppShellProps {
  user: AppShellUser;
  projects?: ProjectItem[];
  children: React.ReactNode;
}

export function AppShell({ user, projects = [], children }: AppShellProps) {
  return (
    <div className="flex h-screen p-2 gap-2">
      <Sidebar user={user} projects={projects} />
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">{children}</main>
    </div>
  );
}
