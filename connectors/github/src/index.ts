import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2, Context } from 'aws-lambda';
import { getLogger } from '@aigo/logger';
import { handleGitHubWebhook } from './handler.js';

const logger = getLogger('github-connector');

export async function handler(
  event: APIGatewayProxyEventV2,
  _context: Context,
): Promise<APIGatewayProxyResultV2> {
  try {
    return await handleGitHubWebhook(event);
  } catch (err) {
    logger.error('Unhandled error in github-connector', { error: String(err) });
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'internal_error' }),
    };
  }
}
