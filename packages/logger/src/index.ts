import { Logger } from '@aws-lambda-powertools/logger';

export interface LogContext {
  readonly orgId?: string;
  readonly jobId?: string;
  readonly runId?: string;
  readonly reportId?: string;
  readonly requestId?: string;
  readonly userId?: string;
  readonly traceId?: string;
  [key: string]: unknown;
}

let _logger: Logger | undefined;

export function getLogger(serviceName?: string): Logger {
  if (!_logger) {
    _logger = new Logger({
      serviceName: serviceName ?? process.env['SERVICE_NAME'] ?? 'aigo',
      logLevel: (process.env['LOG_LEVEL'] as 'DEBUG' | 'INFO' | 'WARN' | 'ERROR') ?? 'INFO',
      persistentLogAttributes: {
        region: process.env['AWS_REGION'] ?? 'ap-northeast-2',
        stage: process.env['STAGE'] ?? 'prod',
        version: process.env['SERVICE_VERSION'] ?? 'unknown',
      },
    });
  }
  return _logger;
}

/** Create a child logger with persistent context appended to every log entry. */
export function createContextLogger(
  context: LogContext,
  serviceName?: string,
): Logger {
  const logger = getLogger(serviceName);
  const child = logger.createChild({
    persistentLogAttributes: context,
  });
  return child;
}

export { Logger };
