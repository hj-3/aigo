import { createRouter, createRootRoute, createRoute, Outlet, redirect } from '@tanstack/react-router';
import { TanStackRouterDevtools } from '@tanstack/router-devtools';
import { getCurrentUser, fetchAuthSession } from 'aws-amplify/auth';
import { Layout } from './components/layout/Layout';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { DashboardPage } from './pages/DashboardPage';
import { ReportsPage } from './pages/ReportsPage';
import { ReportDetailPage } from './pages/ReportDetailPage';
import { IncidentsPage } from './pages/IncidentsPage';
import { IncidentDetailPage } from './pages/IncidentDetailPage';
import { RepositoriesPage } from './pages/RepositoriesPage';
import { FixCenterPage } from './pages/FixCenterPage';
import { JobDetailPage } from './pages/JobDetailPage';
import { SettingsPage } from './pages/SettingsPage';
import { TeamPage } from './pages/TeamPage';

const rootRoute = createRootRoute({
  component: () => (
    <>
      <Outlet />
      {import.meta.env.DEV && <TanStackRouterDevtools />}
    </>
  ),
});

// Unauthenticated routes
const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: LoginPage,
});

const registerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/register',
  component: RegisterPage,
});

// Pre-onboarding route — authenticated but no org yet
const onboardingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/onboarding',
  beforeLoad: async ({ location }) => {
    try {
      await getCurrentUser();
    } catch {
      throw redirect({ to: '/login', search: { from: location.href } });
    }
  },
  component: OnboardingPage,
});

// Checks if onboarding is complete; redirects to /onboarding if not
const protectedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'protected',
  beforeLoad: async ({ location }) => {
    try {
      const user = await getCurrentUser();
      // Check onboardingCompleted attribute from JWT claims
      const session = await fetchAuthSession();
      const claims = session.tokens?.idToken?.payload as Record<string, unknown> | undefined;
      const onboarded = claims?.['custom:onboardingCompleted'];
      if (onboarded !== 'true' && location.pathname !== '/onboarding') {
        throw redirect({ to: '/onboarding' });
      }
    } catch (err) {
      if ((err as { routerCode?: string }).routerCode === 'REDIRECT') throw err;
      throw redirect({ to: '/login', search: { from: location.href } });
    }
  },
  component: () => (
    <Layout>
      <Outlet />
    </Layout>
  ),
});

const dashboardRoute = createRoute({ getParentRoute: () => protectedRoute, path: '/', component: DashboardPage });
const reportsRoute = createRoute({ getParentRoute: () => protectedRoute, path: '/reports', component: ReportsPage });
const reportDetailRoute = createRoute({ getParentRoute: () => protectedRoute, path: '/reports/$reportId', component: ReportDetailPage });
const incidentsRoute = createRoute({ getParentRoute: () => protectedRoute, path: '/incidents', component: IncidentsPage });
const incidentDetailRoute = createRoute({ getParentRoute: () => protectedRoute, path: '/incidents/$incidentId', component: IncidentDetailPage });
const repositoriesRoute = createRoute({ getParentRoute: () => protectedRoute, path: '/repositories', component: RepositoriesPage });
const fixCenterRoute = createRoute({ getParentRoute: () => protectedRoute, path: '/fix', component: FixCenterPage });
const jobDetailRoute = createRoute({ getParentRoute: () => protectedRoute, path: '/jobs/$jobId', component: JobDetailPage });
const settingsRoute = createRoute({ getParentRoute: () => protectedRoute, path: '/settings', component: SettingsPage });
const teamRoute = createRoute({ getParentRoute: () => protectedRoute, path: '/team', component: TeamPage });

const routeTree = rootRoute.addChildren([
  loginRoute,
  registerRoute,
  onboardingRoute,
  protectedRoute.addChildren([
    dashboardRoute,
    reportsRoute,
    reportDetailRoute,
    incidentsRoute,
    incidentDetailRoute,
    repositoriesRoute,
    fixCenterRoute,
    jobDetailRoute,
    settingsRoute,
    teamRoute,
  ]),
]);

export const router = createRouter({ routeTree, defaultPreload: 'intent' });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
