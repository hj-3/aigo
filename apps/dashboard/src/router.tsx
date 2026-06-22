import { createRouter, createRootRoute, createRoute, Outlet, redirect } from '@tanstack/react-router';
import { TanStackRouterDevtools } from '@tanstack/router-devtools';
import { getCurrentUser, fetchAuthSession } from 'aws-amplify/auth';

// Retry wrapper: Amplify token storage occasionally lags behind the signedIn
// Hub event by a tick or two. Three attempts with 400 ms gaps are enough.
async function getUser() {
  for (let i = 0; i < 5; i++) {
    try {
      return await getCurrentUser();
    } catch {
      if (i < 4) await new Promise((r) => setTimeout(r, 300));
    }
  }
  throw new Error('unauthenticated');
}
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
import { AcceptInvitePage } from './pages/AcceptInvitePage';
import { IMTargetsPage } from './pages/im/TargetsPage';
import { IMIncidentsPage } from './pages/im/IncidentsPage';
import { IMRemediationPage } from './pages/im/RemediationPage';
import { IMResourceDiagPage } from './pages/im/ResourceDiagPage';
import { IMSecurityPage } from './pages/im/SecurityPage';
import { IMMonitoringPage } from './pages/im/MonitoringPage';
import { IMManagePage } from './pages/im/ManagePage';

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
    // Step 1 — verify the user is authenticated (retries handle post-OAuth timing)
    let authenticated = false;
    try {
      await getUser();
      authenticated = true;
    } catch {
      throw redirect({ to: '/login', search: { from: location.href } });
    }

    // Step 2 — if authenticated, check onboarding (soft: errors default to /onboarding)
    // Never send an authenticated user back to /login from here.
    if (authenticated) {
      try {
        const session = await fetchAuthSession({ forceRefresh: false });
        const claims = session.tokens?.idToken?.payload as Record<string, unknown> | undefined;
        const onboarded = claims?.['custom:onboardingCompleted'];
        if (onboarded !== 'true' && location.pathname !== '/onboarding') {
          throw redirect({ to: '/onboarding' });
        }
      } catch (err) {
        if ((err as { routerCode?: string }).routerCode === 'REDIRECT') throw err;
        // fetchAuthSession failed but user IS authenticated — go to onboarding, not login
        if (location.pathname !== '/onboarding') {
          throw redirect({ to: '/onboarding' });
        }
      }
    }
  },
  component: () => (
    <Layout>
      <Outlet />
    </Layout>
  ),
});

const inviteRoute = createRoute({ getParentRoute: () => rootRoute, path: '/invite', component: AcceptInvitePage });

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

// Incident Management routes
const imTargetsRoute     = createRoute({ getParentRoute: () => protectedRoute, path: '/im/targets',     component: IMTargetsPage });
const imIncidentsRoute   = createRoute({ getParentRoute: () => protectedRoute, path: '/im/incidents',   component: IMIncidentsPage });
const imRemediationRoute = createRoute({ getParentRoute: () => protectedRoute, path: '/im/remediation', component: IMRemediationPage });
const imDiagRoute        = createRoute({ getParentRoute: () => protectedRoute, path: '/im/diag',        component: IMResourceDiagPage });
const imSecurityRoute    = createRoute({ getParentRoute: () => protectedRoute, path: '/im/security',    component: IMSecurityPage });
const imMonitoringRoute  = createRoute({ getParentRoute: () => protectedRoute, path: '/im/monitoring',  component: IMMonitoringPage });
const imManageRoute      = createRoute({ getParentRoute: () => protectedRoute, path: '/im/manage',      component: IMManagePage });

const routeTree = rootRoute.addChildren([
  loginRoute,
  registerRoute,
  onboardingRoute,
  inviteRoute,
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
    // IM routes
    imTargetsRoute,
    imIncidentsRoute,
    imRemediationRoute,
    imDiagRoute,
    imSecurityRoute,
    imMonitoringRoute,
    imManageRoute,
  ]),
]);

export const router = createRouter({ routeTree, defaultPreload: 'intent' });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
