import type { ReactNode } from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import { signOut } from 'aws-amplify/auth';
import {
  LayoutDashboard,
  FileText,
  AlertTriangle,
  GitBranch,
  Settings,
  Activity,
  Users,
  LogOut,
  Sun,
  Moon,
  Terminal,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme } from '@/lib/theme';
import { useAuthStore } from '@/store/auth';

const navItems = [
  { to: '/',            label: '대시보드',   icon: LayoutDashboard, hint: 'dashboard' },
  { to: '/reports',     label: '분석 리포트', icon: FileText,        hint: 'reports' },
  { to: '/incidents',   label: '인시던트',   icon: AlertTriangle,   hint: 'incidents' },
  { to: '/repositories',label: '리포지토리', icon: GitBranch,       hint: 'repos' },
  { to: '/team',        label: '팀',         icon: Users,           hint: 'team' },
  { to: '/settings',    label: '설정',       icon: Settings,        hint: 'settings' },
];

export function Layout({ children }: { children: ReactNode }) {
  const state = useRouterState();
  const currentPath = state.location.pathname;
  const { theme, toggle } = useTheme();
  const user = useAuthStore((s) => s.user);

  async function handleLogout() {
    try {
      await signOut();
      window.location.href = '/login';
    } catch {
      window.location.href = '/login';
    }
  }

  return (
    <div className="flex h-screen overflow-hidden bg-canvas">
      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 flex flex-col border-r border-term bg-surface">
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-4 py-4 border-b border-term">
          <div className="w-7 h-7 rounded bg-[var(--accent)]/15 flex items-center justify-center">
            <Terminal className="w-3.5 h-3.5 text-accent" />
          </div>
          <div>
            <p className="text-xs font-mono font-bold text-term tracking-tight">AgentOps</p>
            <p className="text-[10px] font-mono text-term-secondary">v1.0 · prod</p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
          {navItems.map(({ to, label, icon: Icon, hint }) => {
            const isActive = to === '/' ? currentPath === '/' : currentPath.startsWith(to);
            return (
              <Link
                key={to}
                to={to}
                className={cn(
                  'group flex items-center gap-2.5 px-2.5 py-2 rounded text-xs font-mono font-medium transition-colors',
                  isActive
                    ? 'bg-[var(--accent)]/10 text-accent'
                    : 'text-term-secondary hover:text-term hover:bg-white/5 dark:hover:bg-white/5',
                )}
              >
                {isActive
                  ? <span className="text-accent font-bold w-3">›</span>
                  : <span className="text-term-secondary/30 w-3 group-hover:text-term-secondary/60">·</span>
                }
                <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                <span>{label}</span>
                {!isActive && (
                  <span className="ml-auto text-[9px] text-term-secondary/30 hidden group-hover:block font-normal">
                    /{hint}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Bottom actions */}
        <div className="px-2 py-3 border-t border-term space-y-0.5">
          {/* User info */}
          {user && (
            <div className="px-2.5 py-2 mb-1">
              <p className="text-[10px] font-mono text-term-secondary truncate">
                <span className="text-accent">@</span>{user.name || user.email}
              </p>
              <p className="text-[9px] font-mono text-term-secondary/50 mt-0.5 truncate">
                {user.role} · {user.orgId?.slice(0, 8) || 'no org'}
              </p>
            </div>
          )}

          {/* Theme toggle */}
          <button
            onClick={toggle}
            className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded text-xs font-mono text-term-secondary hover:text-term hover:bg-white/5 dark:hover:bg-white/5 transition-colors"
          >
            <span className="w-3 text-term-secondary/30">·</span>
            {theme === 'dark'
              ? <Sun className="w-3.5 h-3.5" />
              : <Moon className="w-3.5 h-3.5" />
            }
            <span>{theme === 'dark' ? '라이트 모드' : '다크 모드'}</span>
          </button>

          {/* Logout */}
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded text-xs font-mono text-term-secondary hover:text-red-400 dark:hover:text-red-400 hover:bg-red-500/5 transition-colors"
          >
            <span className="w-3 text-term-secondary/30">·</span>
            <LogOut className="w-3.5 h-3.5" />
            <span>로그아웃</span>
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto bg-canvas">
        {/* Top bar */}
        <div className="sticky top-0 z-10 h-10 px-5 flex items-center justify-between border-b border-term bg-surface/80 backdrop-blur-sm">
          <div className="flex items-center gap-1.5 font-mono text-[10px] text-term-secondary">
            <Activity className="w-3 h-3 text-green-400 animate-pulse-slow" />
            <span className="text-green-400">●</span>
            <span>aigo-prod · ap-northeast-2</span>
          </div>
          <div className="font-mono text-[10px] text-term-secondary/50">
            {new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>

        {/* Page content */}
        <div className="p-6">{children}</div>
      </main>
    </div>
  );
}
