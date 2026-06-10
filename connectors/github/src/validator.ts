import { createHmac, timingSafeEqual } from 'node:crypto';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

export function validateGitHubSignature(
  event: APIGatewayProxyEventV2,
  webhookSecret: string,
): boolean {
  const signature = event.headers['x-hub-signature-256'];
  if (!signature) return false;

  const body = event.body ?? '';
  const rawBody = event.isBase64Encoded ? Buffer.from(body, 'base64').toString('utf-8') : body;

  const expected = `sha256=${createHmac('sha256', webhookSecret).update(rawBody).digest('hex')}`;

  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

export function extractRawBody(event: APIGatewayProxyEventV2): string {
  const body = event.body ?? '';
  return event.isBase64Encoded ? Buffer.from(body, 'base64').toString('utf-8') : body;
}
