import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { Amplify } from 'aws-amplify';
import { Hub } from 'aws-amplify/utils';
import { getCurrentUser } from 'aws-amplify/auth';
import { router } from './router';
import { queryClient } from './lib/query-client';
import { AuthProvider } from './components/AuthProvider';
import { initTheme } from './lib/theme';
import './index.css';

initTheme();

const currentOrigin = `${window.location.origin}/`;

Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID,
      userPoolClientId: import.meta.env.VITE_COGNITO_CLIENT_ID,
      loginWith: {
        oauth: {
          domain: import.meta.env.VITE_COGNITO_DOMAIN,
          scopes: ['email', 'openid', 'profile'],
          redirectSignIn: [currentOrigin],
          redirectSignOut: [currentOrigin],
          responseType: 'code',
        },
      },
    },
  },
});

async function waitForUser(maxMs: number): Promise<boolean> {
  const step = 150;
  let elapsed = 0;
  while (elapsed < maxMs) {
    try {
      await getCurrentUser();
      return true;
    } catch { /* not ready yet */ }
    await new Promise((r) => setTimeout(r, step));
    elapsed += step;
  }
  return false;
}

async function bootstrap() {
  const isOAuthCallback =
    window.location.search.includes('code=') &&
    window.location.search.includes('state=');

  if (isOAuthCallback) {
    // Wait for Amplify to exchange the code for tokens before rendering,
    // otherwise protectedRoute.beforeLoad calls getCurrentUser() too early.
    await new Promise<void>((resolve) => {
      const cancel = Hub.listen('auth', ({ payload }) => {
        if (
          payload.event === 'signedIn' ||
          payload.event === 'signInWithRedirect_failure'
        ) {
          cancel();
          resolve();
        }
      });
      setTimeout(() => { cancel(); resolve(); }, 8_000);
    });

    // Amplify fires signedIn when tokens are in-flight; poll until
    // getCurrentUser() actually resolves so beforeLoad never misses.
    await waitForUser(2_000);
  } else {
    // On a regular page load Amplify restores the session from localStorage.
    // Give it up to 1 s; if no session exists we bail out immediately.
    await waitForUser(1_000);
  }

  const root = document.getElementById('root');
  if (!root) throw new Error('Root element not found');

  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
        <ReactQueryDevtools initialIsOpen={false} />
      </QueryClientProvider>
    </React.StrictMode>,
  );
}

bootstrap();
