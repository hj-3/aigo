import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { handle } from 'hono/aws-lambda';
import type { APIGatewayProxyEventV2, Context } from 'aws-lambda';
import { incidentsRouter } from './routes/incidents.js';
import { reportsRouter } from './routes/reports.js';
import { securityRouter } from './routes/security.js';
import { chatRouter } from './routes/chat.js';
import { accountsRouter } from './routes/accounts.js';
import { imSettingsRouter } from './routes/settings.js';
import { targetsRouter } from './routes/targets.js';
import { imIntegrationsRouter } from './routes/integrations.js';
import { webhookRouter } from './routes/webhook.js';
import { remediationsRouter } from './routes/remediations.js';
import { monitoringRouter } from './routes/monitoring.js';

const app = new Hono();

app.use('*', logger());
app.use('*', cors({
  origin: (origin) => {
    const allowedOrigins = (process.env['ALLOWED_ORIGINS'] ?? '').split(',').map((o) => o.trim());
    return allowedOrigins.includes(origin) ? origin : allowedOrigins[0] ?? '';
  },
  allowHeaders: ['Content-Type', 'Authorization'],
  allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  maxAge: 86400,
}));

app.get('/health', (c) => c.json({ status: 'ok', service: 'im-api' }, 200));

// Webhook has its own auth (token-based) — register before other routes
app.route('/webhook', webhookRouter);

// JWT-protected routes
app.route('/incidents', incidentsRouter);
app.route('/reports', reportsRouter);
app.route('/security', securityRouter);
app.route('/chat', chatRouter);
app.route('/accounts', accountsRouter);
app.route('/settings', imSettingsRouter);
app.route('/targets', targetsRouter);
app.route('/integrations', imIntegrationsRouter);
app.route('/remediations', remediationsRouter);
app.route('/monitoring', monitoringRouter);

app.notFound((c) => c.json({ error: 'NOT_FOUND' }, 404));
app.onError((err, c) => {
  console.error('Unhandled error', err);
  return c.json({ error: 'INTERNAL_ERROR' }, 500);
});

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return handle(app)(event as any, context);
};
