import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface User {
  readonly sub: string;
  readonly email: string;
  readonly name: string;
  readonly orgId: string;
  readonly role: 'OWNER' | 'ADMIN' | 'REVIEWER' | 'VIEWER';
}

interface AuthState {
  user: User | null;
  setUser: (user: User | null) => void;
  isAuthenticated: () => boolean;
  hasRole: (role: User['role']) => boolean;
}

const ROLE_HIERARCHY: Record<User['role'], number> = {
  OWNER: 4,
  ADMIN: 3,
  REVIEWER: 2,
  VIEWER: 1,
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      setUser: (user) => set({ user }),
      isAuthenticated: () => get().user !== null,
      hasRole: (required) => {
        const user = get().user;
        if (!user) return false;
        return ROLE_HIERARCHY[user.role] >= ROLE_HIERARCHY[required];
      },
    }),
    { name: 'aigo-auth' },
  ),
);
