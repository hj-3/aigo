import type { ReactNode } from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import {
  LayoutDashboard,
  FileText,
  AlertTriangle,
  GitBranch,
  Settings,
  Activity,
  Users,
  Link2,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const navItems = [
  { to: '/', label: '대시보드', icon: LayoutDashboard },
  { to: '/reports', label: '분석 리포트', icon: FileText },
  { to: '/incidents', label: '인시던트', icon: AlertTriangle },
  { to: '/repositories', label: '리포지토리', icon: GitBranch },
  { to: '/team', label: '팀 관리', icon: Users },
  { to: '/settings', label: '설정', icon: Settings },
];

export function Layout({ children }: { children: ReactNode }) {
  const state = useRouterState();
  const currentPath = state.location.pathname;

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <aside className="w-64 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 flex flex-col">
        <div className="flex items-center gap-2 px-6 py-5 border-b border-gray-200 dark:border-gray-800">
          <Activity className="w-6 h-6 text-brand-600" />
          <span className="text-lg font-bold text-gray-900 dark:text-white">AgentOps</span>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems.map(({ to, label, icon: Icon }) => {
            const isActive = to === '/' ? currentPath === '/' : currentPath.startsWith(to);
            return (
              <Link
                key={to}
                to={to}
                className={cn(
                  'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-400'
                    : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800',
                )}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-800">
          <p className="text-xs text-gray-400">AgentOps Platform v1.0</p>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <div className="max-w-7xl mx-auto px-6 py-8">{children}</div>
      </main>
    </div>
  );
}
