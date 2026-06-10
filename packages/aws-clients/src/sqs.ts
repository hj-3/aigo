import {
  SQSClient,
  SendMessageCommand,
  SendMessageBatchCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  DeleteMessageBatchCommand,
  GetQueueAttributesCommand,
} from '@aws-sdk/client-sqs';
import { randomUUID } from 'node:crypto';
import { Config } from './config.js';

let _client: SQSClient | undefined;

export function getSqsClient(): SQSClient {
  if (!_client) {
    _client = new SQSClient({ region: Config.region });
  }
  return _client;
}

export async function sqsSendMessage<T extends object>(
  queueUrl: string,
  payload: T,
  options?: {
    readonly messageGroupId?: string;
    readonly messageDeduplicationId?: string;
    readonly delaySeconds?: number;
  },
): Promise<string> {
  const result = await getSqsClient().send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(payload),
      MessageGroupId: options?.messageGroupId,
      MessageDeduplicationId: options?.messageDeduplicationId ?? randomUUID(),
      DelaySeconds: options?.delaySeconds,
    }),
  );
  return result.MessageId ?? '';
}

export async function sqsSendBatch<T extends object>(
  queueUrl: string,
  entries: Array<{ id: string; payload: T; messageGroupId?: string }>,
): Promise<void> {
  const batches: typeof entries[] = [];
  for (let i = 0; i < entries.length; i += 10) {
    batches.push(entries.slice(i, i + 10));
  }

  for (const batch of batches) {
    await getSqsClient().send(
      new SendMessageBatchCommand({
        QueueUrl: queueUrl,
        Entries: batch.map((e) => ({
          Id: e.id,
          MessageBody: JSON.stringify(e.payload),
          MessageGroupId: e.messageGroupId,
          MessageDeduplicationId: randomUUID(),
        })),
      }),
    );
  }
}

export { SendMessageCommand, ReceiveMessageCommand, DeleteMessageCommand, GetQueueAttributesCommand };
