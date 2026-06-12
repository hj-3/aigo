import { LambdaClient, InvokeCommand, InvocationType } from '@aws-sdk/client-lambda';
import { getLogger } from '@aigo/logger';

const logger = getLogger('lambda-client');

const lambdaClient = new LambdaClient({
  region: process.env['AWS_REGION'] ?? 'ap-northeast-2',
});

export function getOrchestratorFunctionName(): string {
  const name = process.env['ORCHESTRATOR_FUNCTION_NAME'];
  if (!name) throw new Error('ORCHESTRATOR_FUNCTION_NAME env var not set');
  return name;
}

/**
 * Invokes the orchestrator Lambda asynchronously (fire-and-forget).
 * The orchestrator handles the full analysis pipeline and updates DynamoDB directly.
 */
export async function invokeOrchestratorAsync(payload: object): Promise<void> {
  const functionName = getOrchestratorFunctionName();

  logger.info('Invoking orchestrator Lambda async', { functionName });

  const command = new InvokeCommand({
    FunctionName: functionName,
    InvocationType: InvocationType.Event, // async — no wait for response
    Payload: Buffer.from(JSON.stringify(payload)),
  });

  const response = await lambdaClient.send(command);

  // Event invocation returns 202 on success
  if (response.StatusCode !== 202) {
    throw new Error(
      `Orchestrator Lambda async invocation failed with status ${response.StatusCode}`,
    );
  }

  logger.info('Orchestrator Lambda invoked successfully', { functionName, statusCode: response.StatusCode });
}
