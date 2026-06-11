import { useEffect } from 'react';
import { Hub } from 'aws-amplify/utils';
import { getCurrentUser, fetchAuthSession } from 'aws-amplify/auth';
import { useAuthStore, type User } from '../store/auth';

type HubCapsule = { payload: { event: string } };

async function resolveUser(): Promise<User | null> {
  try {
    const [current, session] = await Promise.all([
      getCurrentUser(),
      fetchAuthSession(),
    ]);
    const claims = (session.tokens?.idToken?.payload ?? {}) as Record<string, string>;
    return {
      sub: current.userId,
      email: claims['email'] ?? '',
      name: claims['name'] ?? claims['email'] ?? current.username,
      orgId: claims['custom:orgId'] ?? '',
      role: (claims['custom:role'] as User['role']) ?? 'VIEWER',
    };
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const setUser = useAuthStore((s) => s.setUser);

  useEffect(() => {
    resolveUser().then(setUser);

    const stop = Hub.listen('auth', ({ payload }: HubCapsule) => {
      if (payload.event === 'signedIn') {
        resolveUser().then(setUser);
      } else if (
        payload.event === 'signedOut' ||
        payload.event === 'tokenRefresh_failure'
      ) {
        setUser(null);
      }
    });

    return stop;
  }, [setUser]);

  return <>{children}</>;
}
