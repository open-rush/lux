import Image from 'next/image';
import { redirect } from 'next/navigation';
import { auth, signOut } from '@/auth';

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const user = session.user;

  return (
    <div className="flex min-h-screen">
      <aside className="w-64 border-r border-gray-200 dark:border-gray-800 p-4">
        <div className="flex items-center gap-3 mb-6">
          {user.image ? (
            <Image
              src={user.image}
              alt=""
              width={32}
              height={32}
              className="h-8 w-8 rounded-full"
            />
          ) : (
            <div className="h-8 w-8 rounded-full bg-gray-200 dark:bg-gray-700" />
          )}
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{user.name ?? 'User'}</p>
            <p className="text-xs text-gray-500 truncate">{user.email}</p>
          </div>
        </div>
        <h2 className="text-lg font-semibold mb-4">Projects</h2>
        <p className="text-sm text-gray-500">No projects yet.</p>
        <form
          className="mt-auto pt-4"
          action={async () => {
            'use server';
            await signOut({ redirectTo: '/' });
          }}
        >
          <button
            type="submit"
            className="text-sm text-gray-500 hover:text-gray-900 dark:hover:text-gray-100"
          >
            Sign Out
          </button>
        </form>
      </aside>
      <main className="flex-1 p-8">
        <h1 className="text-2xl font-bold mb-4">Dashboard</h1>
        <p className="text-gray-600 dark:text-gray-400">
          Welcome back, {user.name ?? 'there'}. Create a project to get started.
        </p>
      </main>
    </div>
  );
}
