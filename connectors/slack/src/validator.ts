import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Validates Slack request signature.
 * https://api.slack.com/authentication/verifying-requests-from-slack
 */
export function validateSlackSignature(
  signingSecret: string,
  requestTimestamp: string,
  rawBody: string,
  signature: string,
): boolean {
  // Replay attack protection: reject requests older than 5 minutes
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(requestTimestamp)) > 300) {
    return false;
  }

  const baseString = `v0:${requestTimestamp}:${rawBody}`;
  const expected = `v0=${createHmac('sha256', signingSecret).update(baseString).digest('hex')}`;

  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

export function parseSlashCommandBody(
  body: string,
): Record<string, string> {
  return Object.fromEntries(
    body.split('&').map((pair) => {
      const [k, v] = pair.split('=');
      return [decodeURIComponent(k ?? ''), decodeURIComponent((v ?? '').replace(/\+/g, ' '))];
    }),
  );
}
