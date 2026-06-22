function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing required env var: ${key}`);
  return v;
}

function optionalEnv(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

export const ImConfig = {
  get region() { return optionalEnv('AWS_REGION', 'ap-northeast-2'); },
  get tableName() {
    return (name: string) => requireEnv(`IM_${name.toUpperCase()}_TABLE`);
  },
  get tables() {
    return {
      incidents:    requireEnv('IM_INCIDENTS_TABLE'),
      investigation:requireEnv('IM_INVESTIGATION_TABLE'),
      reports:      requireEnv('IM_REPORTS_TABLE'),
      remediations: requireEnv('IM_RECOVERY_ACTIONS_TABLE'),
      targets:      requireEnv('IM_TARGETS_TABLE'),
      integrations: requireEnv('IM_INTEGRATIONS_TABLE'),
      accounts:     requireEnv('IM_LINKED_ACCOUNTS_TABLE'),
      allowedActions:requireEnv('IM_ALLOWED_ACTIONS_TABLE'),
      settings:     requireEnv('IM_SETTINGS_TABLE'),
      securityEvents:requireEnv('IM_SECURITY_EVENTS_TABLE'),
      conversations: requireEnv('IM_CONVERSATIONS_TABLE'),
    };
  },
  get sfnArn() { return requireEnv('IM_SFN_ARN'); },
  get reportsBucket() { return requireEnv('IM_REPORTS_BUCKET'); },
  get eventBusName() { return requireEnv('IM_EVENT_BUS_NAME'); },
};
