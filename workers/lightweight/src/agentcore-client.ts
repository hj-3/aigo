// DEPRECATED: Lightweight worker now dispatches to the orchestrator Lambda (lambda-client.ts).
// Kept for reference. Remove after confirming no other callers.
import { BedrockAgentRuntimeClient, InvokeAgentCommand } from '@aws-sdk/client-bedrock-agent-runtime';
import { getLogger } from '@aigo/logger';
import { Config } from '@aigo/aws-clients';

const logger = getLogger('agentcore-client');

function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env: ${key}`);
  return v;
}

let _client: BedrockAgentRuntimeClient | undefined;

function getClient(): BedrockAgentRuntimeClient {
  if (!_client) {
    _client = new BedrockAgentRuntimeClient({ region: Config.region });
  }
  return _client;
}

interface AgentInvokeParams {
  readonly agentId: string;
  readonly agentAliasId: string;
  readonly sessionId: string;
  readonly inputText: string;
}

interface AgentResponse {
  readonly completion: string;
  readonly sessionId: string;
}

export async function invokeAgent(params: AgentInvokeParams): Promise<AgentResponse> {
  const command = new InvokeAgentCommand({
    agentId: params.agentId,
    agentAliasId: params.agentAliasId,
    sessionId: params.sessionId,
    inputText: params.inputText,
    enableTrace: true,
  });

  const response = await getClient().send(command);

  const chunks: string[] = [];
  if (response.completion) {
    for await (const event of response.completion) {
      if (event.chunk?.bytes) {
        chunks.push(Buffer.from(event.chunk.bytes).toString('utf-8'));
      }
    }
  }

  const completion = chunks.join('');
  logger.debug('AgentCore response received', {
    agentId: params.agentId,
    sessionId: params.sessionId,
    completionLength: completion.length,
  });

  return { completion, sessionId: params.sessionId };
}

export function getOrchestratorAgentId(): string {
  return requireEnv('ORCHESTRATOR_AGENT_ID');
}

export function getOrchestratorAgentAliasId(): string {
  return requireEnv('ORCHESTRATOR_AGENT_ALIAS_ID');
}
