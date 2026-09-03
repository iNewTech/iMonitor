import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_JIRA_SETTINGS } from '../../features/integrations/jira/jira-model';
import { createJiraRuntime } from './jira-runtime';

describe('jira-runtime', () => {
    it('reports whether Jira alert delivery is configured', () => {
        const runtime = createJiraRuntime({
            getSettings: () => ({
                ...DEFAULT_JIRA_SETTINGS,
                enabled: true,
                baseUrl: 'https://example.atlassian.net',
                username: 'ops@example.com',
                apiToken: 'secret-token',
                projectKey: 'OPS'
            }),
            recordActivity: vi.fn()
        });

        expect(runtime.canSendAlerts()).toBe(true);
    });

    it('creates an incident issue through the Jira REST API', async () => {
        const recordActivity = vi.fn();
        const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
            expect(url).toBe('https://example.atlassian.net/rest/api/3/issue');
            expect(init?.method).toBe('POST');
            expect(init?.headers).toEqual(expect.objectContaining({
                Accept: 'application/json',
                'Content-Type': 'application/json',
                Authorization: `Basic ${Buffer.from('ops@example.com:secret-token').toString('base64')}`
            }));
            const payload = JSON.parse(String(init?.body ?? '{}'));
            expect(payload.fields.project.key).toBe('OPS');
            return new Response(JSON.stringify({ id: '10001', key: 'OPS-42' }), { status: 201 });
        });
        const runtime = createJiraRuntime({
            getSettings: () => ({
                ...DEFAULT_JIRA_SETTINGS,
                enabled: true,
                baseUrl: 'https://example.atlassian.net',
                username: 'ops@example.com',
                apiToken: 'secret-token',
                projectKey: 'OPS'
            }),
            recordActivity,
            fetchImpl: fetchImpl as typeof fetch
        });

        const issue = await runtime.sendAlert({
            id: 'msgw:123/QINTER/DEMOJOB',
            kind: 'messageWait',
            severity: 'critical',
            timestamp: '2026-09-03T09:00:00.000Z',
            title: 'MSGW detected',
            message: 'QINTER/DEMOJOB entered message wait.',
            workflowStatus: 'new',
            notes: [],
            timeline: [],
            workflowUpdatedAt: '2026-09-03T09:00:00.000Z'
        });

        expect(issue).toEqual({
            id: '10001',
            key: 'OPS-42',
            url: 'https://example.atlassian.net/browse/OPS-42'
        });
        expect(recordActivity).toHaveBeenCalledWith(expect.objectContaining({
            message: 'Created alert issue in Jira.',
            detail: 'OPS-42 · https://example.atlassian.net/browse/OPS-42'
        }));
    });

    it('rejects an incomplete or insecure Jira configuration', async () => {
        const runtime = createJiraRuntime({
            getSettings: () => ({
                ...DEFAULT_JIRA_SETTINGS,
                enabled: true,
                baseUrl: 'http://example.atlassian.net',
                projectKey: 'OPS'
            }),
            recordActivity: vi.fn(),
            fetchImpl: vi.fn()
        });

        await expect(runtime.sendTestMessage()).rejects.toThrow('Complete the Jira site URL');
    });
});
