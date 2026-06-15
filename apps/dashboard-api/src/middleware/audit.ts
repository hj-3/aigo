import type { Context, Next } from 'hono';
import { ulid } from 'ulid';
import { ddbPut, Config } from '@aigo/aws-clients';
import { extractClaims } from './auth.js';

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Audit log middleware. Records all state-changing API calls to the AuditLogs table.
 * Attach to routes that modify data: POST, PUT, PATCH, DELETE.
 *
 * Usage:
 *   router.use('*', auditLog());
 *   router.post('/', auditLog(), handler);
 */
export function auditLog() {
  return async (c: Context, next: Next): Promise<void> => {
    const method = c.req.method;

    // Only audit state-changing operations
    if (!STATE_CHANGING_METHODS.has(method)) {
      await next();
      return;
    }

    const claims = extractClaims(c);
    const userId = claims?.sub ?? 'anonymous';
    const orgId = claims?.['custom:orgId'] ?? '';
    const path = new URL(c.req.url).pathname;
    const ipAddress = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
      ?? c.req.header('x-real-ip')
      ?? 'unknown';

    // Capture request body for audit (clone before it's consumed)
    let requestBody: string | undefined;
    try {
      const cloned = c.req.raw.clone();
      const text = await cloned.text();
      // Redact sensitive fields before logging
      if (text) {
        const parsed = JSON.parse(text);
        requestBody = JSON.stringify(redactSensitiveFields(parsed));
      }
    } catch {
      // Non-JSON body or stream already consumed
    }

    let statusCode = 200;

    try {
      await next();
      statusCode = c.res.status;
    } catch (err) {
      statusCode = 500;
      throw err;
    } finally {
      // Fire-and-forget audit write — do not block response
      const logId = ulid();
      const now = new Date().toISOString();

      ddbPut({
        TableName: Config.tableName('AuditLogs'),
        Item: {
          PK: `AUDIT#${logId}`,
          SK: 'LOG',
          logId,
          userId,
          orgId,
          action: `${method} ${path}`,
          httpMethod: method,
          httpPath: path,
          httpStatus: statusCode,
          requestBody: requestBody ?? null,
          ipAddress,
          userAgent: c.req.header('user-agent') ?? '',
          createdAt: now,
          GSI1PK: `ORG#${orgId}`,
          GSI1SK: now,
          GSI2PK: `USER#${userId}`,
          GSI2SK: now,
          ttl: Math.floor(Date.now() / 1000) + (90 * 24 * 3600), // 90-day retention
        },
      }).catch((err) => {
        // Never fail the request due to audit log errors
        console.error('[audit] Failed to write audit log', { logId, error: String(err) });
      });
    }
  };
}

const SENSITIVE_FIELDS = new Set([
  'password', 'token', 'secret', 'privateKey', 'accessKey',
  'clientSecret', 'apiKey', 'credential', 'authorization',
]);

function redactSensitiveFields(obj: unknown): unknown {
  if (typeof obj !== 'object' || obj === null) return obj;
  if (Array.isArray(obj)) return obj.map(redactSensitiveFields);

  return Object.fromEntries(
    Object.entries(obj as Record<string, unknown>).map(([k, v]) => [
      k,
      SENSITIVE_FIELDS.has(k.toLowerCase()) ? '[REDACTED]' : redactSensitiveFields(v),
    ]),
  );
}
