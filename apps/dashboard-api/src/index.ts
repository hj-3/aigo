import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { handle } from 'hono/aws-lambda';
import { reportsRouter } from './routes/reports.js';
import { incidentsRouter } from './routes/incidents.js';
import { repositoriesRouter } from './routes/repositories.js';
import { dashboardRouter } from './routes/dashboard.js';
import { fixesRouter } from './routes/fixes.js';
import { jobsRouter } from './routes/jobs.js';
import { settingsRouter } from './routes/settings.js';

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

export const handler = handle(app);
