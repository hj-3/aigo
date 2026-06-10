import type { SQSEvent, SQSBatchResponse, Context } from 'aws-lambda';
import { getLogger } from '@aigo/logger';
import { processRecord } from './handler.js';

const logger = getLogger('notification-worker');

export async function handler(event: SQSEvent, _context: Context): Promise<SQSBatchResponse> {
  const failures: SQSBatchResponse['batchItemFailures'] = [];

  await Promise.allSettled(
    event.Records.map(async (record) => {
      try {
        await processRecord(record);
      } catch (err) {
        logger.error('Failed to process notification record', {
          messageId: record.messageId,
          error: String(err),
        });
        failures.push({ itemIdentifier: record.messageId });
      }
    }),
  );

  return { batchItemFailures: failures };
}
