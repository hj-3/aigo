import { Hono } from 'hono';
import { CloudWatchClient, DescribeAlarmsCommand } from '@aws-sdk/client-cloudwatch';
import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';
import { ddbQuery, ddbGet } from '@aigo/aws-clients';
import { requireAuth, extractClaims } from '../middleware/auth.js';
import { ImConfig } from '../config.js';

export const monitoringRouter = new Hono();

monitoringRouter.use('*', requireAuth());

const sts = new STSClient({ region: ImConfig.region });

async function getCrossAccountCW(crossAccountRoleArn: string, region: string): Promise<CloudWatchClient> {
  const assumed = await sts.send(new AssumeRoleCommand({
    RoleArn: crossAccountRoleArn,
    RoleSessionName: 'aigo-im-monitoring',
    ExternalId: 'aigo-im-monitoring',
    DurationSeconds: 900,
  }));
  const creds = assumed.Credentials!;
  return new CloudWatchClient({
    region,
    credentials: {
      accessKeyId: creds.AccessKeyId!,
      secretAccessKey: creds.SecretAccessKey!,
      sessionToken: creds.SessionToken,
    },
  });
}

monitoringRouter.get('/', async (c) => {
  const claims = extractClaims(c)!;
  const orgId = claims['custom:orgId'];

  const { items: targets } = await ddbQuery({
    TableName: ImConfig.tables.targets,
    KeyConditionExpression: 'PK = :pk',
    ExpressionAttributeValues: { ':pk': `ORG#${orgId}` },
    Limit: 200,
  });

  if (targets.length === 0) return c.json({ items: [] });

  // Group targets by accountId so we only AssumeRole once per account
  const byAccount = new Map<string, Array<Record<string, unknown>>>();
  for (const t of targets as Array<Record<string, unknown>>) {
    const accountId = (t['accountId'] as string) ?? 'self';
    if (!byAccount.has(accountId)) byAccount.set(accountId, []);
    byAccount.get(accountId)!.push(t);
  }

  // Build a map: alarmName → alarm state (across all accounts)
  const alarmMap = new Map<string, { state: string; threshold: number; updatedAt: string }>();

  await Promise.all(
    Array.from(byAccount.entries()).map(async ([accountId, accountTargets]) => {
      try {
        let cw: CloudWatchClient;

        if (accountId === 'self') {
          cw = new CloudWatchClient({ region: ImConfig.region });
        } else {
          // Look up crossAccountRoleArn from linked accounts table
          const linkedAccount = await ddbGet({
            TableName: ImConfig.tables.accounts,
            Key: { PK: `ORG#${orgId}`, SK: `ACCOUNT#${accountId}` },
          }) as Record<string, string> | null;

          if (!linkedAccount?.crossAccountRoleArn) {
            // Fallback: describe alarms in central account (may not find them)
            cw = new CloudWatchClient({ region: ImConfig.region });
          } else {
            const region = linkedAccount['region'] ?? ImConfig.region;
            cw = await getCrossAccountCW(linkedAccount.crossAccountRoleArn, region);
          }
        }

        const alarmNames = accountTargets
          .map((t) => t['alarmName'] as string)
          .filter(Boolean);

        // DescribeAlarms accepts max 100 names per call
        for (let i = 0; i < alarmNames.length; i += 100) {
          const batch = alarmNames.slice(i, i + 100);
          const resp = await cw.send(new DescribeAlarmsCommand({ AlarmNames: batch, MaxRecords: 100 }));
          for (const alarm of resp.MetricAlarms ?? []) {
            if (alarm.AlarmName) {
              alarmMap.set(alarm.AlarmName, {
                state: alarm.StateValue ?? 'INSUFFICIENT_DATA',
                threshold: alarm.Threshold ?? 0,
                updatedAt: alarm.StateUpdatedTimestamp?.toISOString() ?? new Date().toISOString(),
              });
            }
          }
        }
      } catch (err) {
        // Partial failure — log and continue with other accounts
        console.error(`[monitoring] CloudWatch query failed for account ${accountId}:`, err);
      }
    }),
  );

  const items = (targets as Array<Record<string, unknown>>).map((t) => {
    const alarmName = t['alarmName'] as string;
    const alarm = alarmMap.get(alarmName);
    return {
      accountId: t['accountId'] ?? 'self',
      serviceName: t['serviceName'],
      alarmName,
      threshold: alarm?.threshold ?? 0,
      state: alarm?.state ?? 'INSUFFICIENT_DATA',
      updatedAt: alarm?.updatedAt ?? new Date().toISOString(),
    };
  });

  return c.json({ items });
});
