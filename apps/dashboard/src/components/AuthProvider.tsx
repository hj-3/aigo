import { useEffect } from 'react';
import { Hub } from 'aws-amplify/utils';
import { getCurrentUser, fetchUserAttributes } from 'aws-amplify/auth';
import { useAuthStore, type User } from '../store/auth';

type HubCapsule = { payload: { event: string } };

async function resolveUser(): Promise<User | null> {
  try {
    const current = await getCurrentUser();
    const attrs = await fetchUserAttributes();
    return {
      sub: current.userId,
      email: attrs['email'] ?? '',
      name: attrs['name'] ?? attrs['email'] ?? current.username,
      orgId: attrs['custom:orgId'] ?? '',
      role: (attrs['custom:role'] as User['role']) ?? 'VIEWER',
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
