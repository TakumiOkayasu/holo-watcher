import { describe, it, expect, vi } from 'vitest';
import {
  parseAutomationNotice,
  deliverAutomationNotice,
  type NotificationStore,
} from '../src/automation-notifications';

function payload() {
  return {
    action: 'opened',
    repository: { full_name: 'owner/repo', archived: false, owner: { login: 'owner' } },
    pull_request: {
      number: 17,
      title: 'Bump a dependency',
      body: null as string | null,
      state: 'open',
      user: { login: 'dependabot[bot]', type: 'Bot' },
      assignees: [],
      requested_reviewers: [],
      requested_teams: [],
      html_url: 'https://untrusted.invalid/do-not-forward',
    },
  };
}

function issuePayload() {
  const { pull_request, ...common } = payload();
  return { ...common, issue: pull_request };
}

function notice() {
  return parseAutomationNotice('pull_request', payload(), 'owner')!;
}

function store(): NotificationStore {
  const values = new Map<string, string>();
  return {
    get: vi.fn(async (key: string) => values.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => { values.set(key, value); }),
  };
}

describe('automation event selection', () => {
  it.each(['pull_request', 'issues'] as const)('selects an opened Bot-authored %s', kind => {
    const parsed = parseAutomationNotice(kind, kind === 'issues' ? issuePayload() : payload(), 'owner');
    expect(parsed?.kind).toBe(kind);
    expect(parsed?.url).toBe(`https://github.com/owner/repo/${kind === 'pull_request' ? 'pull' : 'issues'}/17`);
  });

  it.each([undefined, '', ' ', 'user,name', '@owner'])('requires one valid recipient: %s', login => {
    expect(parseAutomationNotice('pull_request', payload(), login)).toBeNull();
  });

  it.each([null, 'push', 'workflow_run', 'issue_comment'])('ignores unsupported event %s', event => {
    expect(parseAutomationNotice(event, payload(), 'owner')).toBeNull();
  });

  it.each(['edited', 'reopened', 'closed', 'synchronize', 'review_requested'])('ignores action %s', action => {
    expect(parseAutomationNotice('pull_request', { ...payload(), action }, 'owner')).toBeNull();
  });

  it.each([
    { user: { login: 'human', type: 'User' } },
    { user: { login: 'OWNER', type: 'Bot' } },
    { assignees: [{ login: 'OWNER' }] },
    { requested_reviewers: [{ login: 'OWNER' }] },
    { requested_teams: [{ slug: 'team' }] },
    { body: 'Please check, @OwNeR.' },
    { title: '@owner review this' },
    { body: '@org/security-team please check' },
    { assignees: null },
    { assignees: [{}] },
    { requested_reviewers: null },
    { requested_teams: undefined },
    { body: undefined },
    { number: 0 },
    { number: 1.5 },
    { number: '17' },
    { title: '' },
    { state: 'closed' },
  ])('suppresses personal notifications and unsafe shapes: %j', change => {
    const original = payload();
    const input = { ...original, pull_request: { ...original.pull_request, ...change } };
    expect(parseAutomationNotice('pull_request', input, 'owner')).toBeNull();
  });

  it('does not confuse a similarly prefixed login with the recipient', () => {
    const original = payload();
    original.pull_request.body = '@owner-other';
    expect(parseAutomationNotice('pull_request', original, 'owner')).not.toBeNull();
  });

  it('ignores archived, malformed and issue-shaped PR payloads', () => {
    expect(parseAutomationNotice('pull_request', null, 'owner')).toBeNull();
    expect(parseAutomationNotice('pull_request', [], 'owner')).toBeNull();
    const original = payload();
    original.repository.archived = true;
    expect(parseAutomationNotice('pull_request', original, 'owner')).toBeNull();
    const issue = issuePayload();
    expect(parseAutomationNotice('issues', { ...issue, issue: { ...issue.issue, pull_request: {} } }, 'owner')).toBeNull();
  });
});

describe('automation delivery', () => {
  it('sends without mention pings or issue body, then deduplicates the opened item', async () => {
    const kv = store();
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 200 }));
    expect(await deliverAutomationNotice(notice(), kv, 'https://discord.com/api/webhooks/test?thread_id=42', transport)).toBe('sent');
    expect(await deliverAutomationNotice(notice(), kv, 'https://discord.com/api/webhooks/test', transport)).toBe('duplicate');
    expect(transport).toHaveBeenCalledTimes(1);
    const [url, init] = transport.mock.calls[0];
    expect(new URL(String(url)).searchParams.get('wait')).toBe('true');
    expect(new URL(String(url)).searchParams.get('thread_id')).toBe('42');
    const body = JSON.parse(String(init?.body));
    expect(body.allowed_mentions).toEqual({ parse: [] });
    expect(body.embeds[0].url).toBe(notice().url);
    expect(kv.put).toHaveBeenCalledWith('automation:v1:owner/repo:pull_request:17', 'sent', { expirationTtl: 2592000 });
  });

  it.each([429, 500])('does not mark HTTP %s as delivered; retry can succeed', async status => {
    const kv = store();
    const transport = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    await expect(deliverAutomationNotice(notice(), kv, 'https://discord.com/api/webhooks/test', transport)).rejects.toThrow(`HTTP ${status}`);
    expect(kv.put).not.toHaveBeenCalled();
    expect(await deliverAutomationNotice(notice(), kv, 'https://discord.com/api/webhooks/test', transport)).toBe('sent');
  });

  it('does not mark transport errors as delivered', async () => {
    const kv = store();
    const transport = vi.fn<typeof fetch>().mockRejectedValue(new Error('timeout'));
    await expect(deliverAutomationNotice(notice(), kv, 'https://discord.com/api/webhooks/test', transport)).rejects.toThrow('timeout');
    expect(kv.put).not.toHaveBeenCalled();
  });

  it('does not send if deduplication storage cannot be read', async () => {
    const kv = store();
    vi.mocked(kv.get).mockRejectedValue(new Error('storage unavailable'));
    const transport = vi.fn<typeof fetch>();
    await expect(deliverAutomationNotice(notice(), kv, 'https://discord.com/api/webhooks/test', transport)).rejects.toThrow('storage unavailable');
    expect(transport).not.toHaveBeenCalled();
  });
});
