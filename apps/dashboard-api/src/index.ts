import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { handle } from 'hono/aws-lambda';
import type { APIGatewayProxyEventV2, Context } from 'aws-lambda';
import { reportsRouter } from './routes/reports.js';
import { incidentsRouter } from './routes/incidents.js';
import { repositoriesRouter } from './routes/repositories.js';
import { dashboardRouter } from './routes/dashboard.js';
import { fixesRouter } from './routes/fixes.js';
import { jobsRouter } from './routes/jobs.js';
import { settingsRouter } from './routes/settings.js';
import { onboardingRouter } from './routes/onboarding.js';
import { teamRouter } from './routes/team.js';
import { integrationsRouter } from './routes/integrations.js';
import { auditLog } from './middleware/audit.js';

const app = new Hono();

app.use('*', logger());
app.use('*', cors({
  origin: (origin) => {
    const allowedOrigins = (process.env['ALLOWED_ORIGINS'] ?? '').split(',').map((o) => o.trim());
    return allowedOrigins.includes(origin) ? origin : allowedOrigins[0] ?? '';
  },
  allowHeaders: ['Content-Type', 'Authorization'],
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  maxAge: 86400,
}));
// Audit all state-changing operations across all routes
app.use('*', auditLog());

app.get('/health', (c) => c.json({ status: 'ok' }, 200));

// Multi-tenancy routes (onboarding allowed pre-org; others require onboardingCompleted)
app.route('/onboarding', onboardingRouter);
app.route('/team', teamRouter);
app.route('/integrations', integrationsRouter);

app.route('/dashboard', dashboardRouter);
app.route('/reports', reportsRouter);
app.route('/incidents', incidentsRouter);
app.route('/repositories', repositoriesRouter);
app.route('/fix', fixesRouter);
app.route('/jobs', jobsRouter);
app.route('/settings', settingsRouter);

app.notFound((c) => c.json({ error: 'NOT_FOUND' }, 404));
app.onError((err, c) => {
  console.error('Unhandled error', err);
  return c.json({ error: 'INTERNAL_ERROR', message: 'An unexpected error occurred' }, 500);
});

// API Gateway HTTP API sends rawPath as /stage/path (e.g. /prod/reports).
// Strip the stage prefix so Hono routing works correctly.
export const handler = async (event: APIGatewayProxyEventV2, context: Context) => {
  const stage = event.requestContext?.stage;
  if (stage && stage !== '$default') {
    const prefix = `/${stage}`;
    if (event.rawPath?.startsWith(prefix)) {
      event = {
        ...event,
        rawPath: event.rawPath.slice(prefix.length) || '/',
        requestContext: {
          ...event.requestContext,
          http: {
            ...event.requestContext.http,
            path: event.requestContext.http.path?.startsWith(prefix)
              ? event.requestContext.http.path.slice(prefix.length) || '/'
              : event.requestContext.http.path,
          },
        },
      };
    }
  }
  return handle(app)(event, context);
};
