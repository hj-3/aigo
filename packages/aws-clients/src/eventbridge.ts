import {
  EventBridgeClient,
  PutEventsCommand,
} from '@aws-sdk/client-eventbridge';
import type { PutEventsRequestEntry } from '@aws-sdk/client-eventbridge';
import { Config } from './config.js';

let _client: EventBridgeClient | undefined;

export function getEventBridgeClient(): EventBridgeClient {
  if (!_client) {
    _client = new EventBridgeClient({ region: Config.region });
  }
  return _client;
}

export async function putEvent(
  detailType: string,
  detail: unknown,
  source = 'aigo.platform',
): Promise<void> {
  const entry: PutEventsRequestEntry = {
    EventBusName: Config.eventBusName,
    Source: source,
    DetailType: detailType,
    Detail: JSON.stringify(detail),
    Time: new Date(),
  };

  const result = await getEventBridgeClient().send(
    new PutEventsCommand({ Entries: [entry] }),
  );

  if ((result.FailedEntryCount ?? 0) > 0) {
    throw new Error(
      `EventBridge PutEvents failed: ${JSON.stringify(result.Entries)}`,
    );
  }
}

export { PutEventsCommand };
export type { PutEventsRequestEntry };
