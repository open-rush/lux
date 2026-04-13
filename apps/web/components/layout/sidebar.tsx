'use client';

import { FolderOpen, Home, LogOut, Monitor, Moon, Plus, Sun } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTheme } from '@/components/theme-provider';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

interface SidebarUser {
  name?: string | null;
  email?: string | null;
  image?: string | null;
}

interface ProjectItem {
  id: string;
  name: string;
}

interface SidebarProps {
  user: SidebarUser;
  projects?: ProjectItem[];
}

export function Sidebar({ user, projects = [] }: SidebarProps) {
  const { theme, setTheme } = useTheme();
  const pathname = usePathname();

  const cycleTheme = () => {
    const next = theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light';
    setTheme(next);
  };

  const ThemeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;

  return (
    <aside className="flex flex-col h-full w-[240px] bg-secondary rounded-xl p-3 gap-2">
      {/* Brand */}
      <div className="flex items-center gap-2 px-2 py-1">
        <span className="text-lg font-semibold tracking-tight">OpenRush</span>
      </div>

      {/* Navigation */}
      <Link
        href="/dashboard"
        className={cn(
          'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm',
          pathname === '/dashboard' ? 'bg-accent font-medium' : 'hover:bg-accent/50'
        )}
      >
        <Home className="h-4 w-4" />
        Dashboard
      </Link>

      <Link href="/dashboard">
        <Button variant="outline" className="w-full justify-start gap-2" size="sm">
          <Plus className="h-4 w-4" />
          New Chat
        </Button>
      </Link>

      <Separator />

      {/* Projects */}
      <div className="flex items-center justify-between px-2">
        <span className="text-xs font-medium text-muted-foreground uppercase">Projects</span>
      </div>
      <div className="flex-1 overflow-auto custom-scrollbar">
        {projects.length === 0 ? (
          <p className="text-xs text-muted-foreground px-2 mt-1">No projects yet.</p>
        ) : (
          <div className="space-y-0.5">
            {projects.map((project) => (
              <Link
                key={project.id}
                href={`/projects/${project.id}`}
                className={cn(
                  'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm',
                  pathname.startsWith(`/projects/${project.id}`)
                    ? 'bg-accent font-medium'
                    : 'hover:bg-accent/50'
                )}
              >
                <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{project.name}</span>
              </Link>
            ))}
          </div>
        )}
      </div>

      <Separator />

      {/* Bottom: user + theme + sign out */}
      <div className="flex items-center gap-2 px-1 py-1">
        <Avatar className="h-7 w-7" size="sm">
          {user.image && <AvatarImage src={user.image} />}
          <AvatarFallback>{(user.name ?? user.email ?? '?').slice(0, 2)}</AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{user.name ?? 'User'}</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={cycleTheme}
          aria-label={`Switch theme (current: ${theme})`}
          className="h-7 w-7"
        >
          <ThemeIcon className="h-4 w-4" />
        </Button>
        <form action="/api/auth/signout" method="POST">
          <Button
            variant="ghost"
            size="icon"
            type="submit"
            aria-label="Sign out"
            className="h-7 w-7"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </form>
      </div>
    </aside>
  );
}
