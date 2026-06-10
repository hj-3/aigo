import type { Context, MiddlewareHandler, Next } from 'hono';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

interface JwtClaims {
  sub: string;
  email: string;
  name: string;
  'custom:orgId': string;
  'custom:role': string;
}

export function extractClaims(c: Context): JwtClaims | null {
  const event = c.env as unknown as APIGatewayProxyEventV2;
  const claims = (event.requestContext as unknown as {
    authorizer?: { jwt?: { claims?: Record<string, string> } }
  }).authorizer?.jwt?.claims;
  if (!claims?.['sub']) return null;
  return claims as unknown as JwtClaims;
}

export function requireAuth(): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    const claims = extractClaims(c);
    if (!claims) {
      return c.json({ error: 'UNAUTHORIZED' }, 401);
    }
    c.set('claims', claims);
    await next();
    return;
  };
}

export function requireRole(minRole: 'OWNER' | 'ADMIN' | 'REVIEWER' | 'VIEWER'): MiddlewareHandler {
  const hierarchy = { OWNER: 4, ADMIN: 3, REVIEWER: 2, VIEWER: 1 };
  return async (c: Context, next: Next) => {
    const claims = extractClaims(c);
    if (!claims) {
      return c.json({ error: 'UNAUTHORIZED' }, 401);
    }
    const role = claims['custom:role'] as keyof typeof hierarchy;
    if ((hierarchy[role] ?? 0) < hierarchy[minRole]) {
      return c.json({ error: 'FORBIDDEN' }, 403);
    }
    c.set('claims', claims);
    await next();
    return;
  };
}
