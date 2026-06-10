import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2, Context } from 'aws-lambda';
import { getLogger } from '@aigo/logger';
import { handleSlackCommand } from './handler.js';

const logger = getLogger('slack-connector');

export async function handler(
  event: APIGatewayProxyEventV2,
  _context: Context,
): Promise<APIGatewayProxyResultV2> {
  try {
    return await handleSlackCommand(event);
  } catch (err) {
    logger.error('Unhandled error in slack-connector', { error: String(err) });
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ response_type: 'ephemeral', text: '일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요.' }),
    };
  }
}
