import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { Amplify } from 'aws-amplify';
import { router } from './router';
import { queryClient } from './lib/query-client';
import { AuthProvider } from './components/AuthProvider';
import './index.css';

// Use the current origin at runtime so OAuth redirect always matches the domain
// the user actually accessed — works for CloudFront domain, custom domain, and localhost.
// All these origins must be registered in Cognito allowed_callback_urls (managed by Terraform).
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
