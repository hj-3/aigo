import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
  TransactWriteCommand,
  BatchGetCommand,
  BatchWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import type {
  GetCommandInput,
  GetCommandOutput,
  PutCommandInput,
  UpdateCommandInput,
  DeleteCommandInput,
  QueryCommandInput,
  QueryCommandOutput,
  TransactWriteCommandInput,
} from '@aws-sdk/lib-dynamodb';
import { Config } from './config.js';

let _client: DynamoDBDocumentClient | undefined;

export function getDynamoClient(): DynamoDBDocumentClient {
  if (!_client) {
    const base = new DynamoDBClient({ region: Config.region });
    _client = DynamoDBDocumentClient.from(base, {
      marshallOptions: {
        removeUndefinedValues: true,
        convertEmptyValues: false,
        convertClassInstanceToMap: false,
      },
      unmarshallOptions: {
        wrapNumbers: false,
      },
    });
  }
  return _client;
}

export async function ddbGet<T>(
  params: GetCommandInput,
): Promise<T | undefined> {
  const result = await getDynamoClient().send(new GetCommand(params));
  return result.Item as T | undefined;
}

export async function ddbPut(params: PutCommandInput): Promise<void> {
  await getDynamoClient().send(new PutCommand(params));
}

export async function ddbUpdate(params: UpdateCommandInput): Promise<void> {
  await getDynamoClient().send(new UpdateCommand(params));
}

export async function ddbDelete(params: DeleteCommandInput): Promise<void> {
  await getDynamoClient().send(new DeleteCommand(params));
}

export async function ddbQuery<T>(
  params: QueryCommandInput,
): Promise<{ items: T[]; lastKey?: Record<string, unknown> }> {
  const results: T[] = [];
  let lastKey: Record<string, unknown> | undefined;

  const result: QueryCommandOutput = await getDynamoClient().send(
    new QueryCommand(params),
  );
  results.push(...((result.Items ?? []) as T[]));
  lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;

  return { items: results, ...(lastKey !== undefined && { lastKey }) };
}

export async function ddbQueryAll<T>(params: QueryCommandInput): Promise<T[]> {
  const results: T[] = [];
  let lastKey: Record<string, unknown> | undefined;

  do {
    const result: QueryCommandOutput = await getDynamoClient().send(
      new QueryCommand({ ...params, ExclusiveStartKey: lastKey }),
    );
    results.push(...((result.Items ?? []) as T[]));
    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);

  return results;
}

export async function ddbTransact(
  params: TransactWriteCommandInput,
): Promise<void> {
  await getDynamoClient().send(new TransactWriteCommand(params));
}

export { GetCommand, PutCommand, UpdateCommand, DeleteCommand, QueryCommand, TransactWriteCommand, BatchGetCommand, BatchWriteCommand };
export type { GetCommandInput, GetCommandOutput, PutCommandInput, UpdateCommandInput, DeleteCommandInput, QueryCommandInput };
