/** GitHub Webhook payload (minimal — full schema from @octokit/webhooks-types) */
export interface GitHubPRWebhookPayload {
  readonly action:
    | 'opened'
    | 'synchronize'
    | 'closed'
    | 'reopened'
    | 'ready_for_review';
  readonly number: number;
  readonly pull_request: {
    readonly id: number;
    readonly node_id: string;
    readonly title: string;
    readonly html_url: string;
    readonly head: { readonly sha: string; readonly ref: string };
    readonly base: { readonly ref: string };
    readonly user: { readonly login: string };
    readonly state: 'open' | 'closed';
    readonly merged: boolean;
    readonly draft: boolean;
  };
  readonly repository: {
    readonly id: number;
    readonly node_id: string;
    readonly full_name: string;
    readonly name: string;
    readonly private: boolean;
    readonly default_branch: string;
  };
  readonly installation?: {
    readonly id: number;
  };
}

/** Slack Slash Command payload */
export interface SlackSlashCommandPayload {
  readonly token: string;
  readonly command: string;           // "/approve", "/reject", "/investigate"
  readonly text: string;
  readonly user_id: string;
  readonly user_name: string;
  readonly team_id: string;
  readonly channel_id: string;
  readonly response_url: string;
}

/** CloudWatch Alarm state change event (via EventBridge) */
export interface CloudWatchAlarmEvent {
  readonly source: 'aws.cloudwatch';
  readonly 'detail-type': 'CloudWatch Alarm State Change';
  readonly detail: {
    readonly alarmName: string;
    readonly state: { readonly value: 'ALARM' | 'OK' | 'INSUFFICIENT_DATA' };
    readonly previousState: { readonly value: string };
    readonly configuration: {
      readonly description?: string;
      readonly metrics: readonly Array<{ readonly id: string }>;
    };
  };
  readonly resources: readonly string[];
  readonly region: string;
  readonly account: string;
}
