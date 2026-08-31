import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SLACK_SETTINGS } from '../../features/integrations/slack/slack-model';
import { createSlackRuntime } from './slack-runtime';

describe('slack-runtime', () => {
    it('reports whether Slack alert delivery is configured', () => {
        const runtime = createSlackRuntime({
            getSettings: () => ({
                ...DEFAULT_SLACK_SETTINGS,
                enabled: true,
                webhookUrl: 'https://hooks.slack.com/services/demo'
            }),
            recordActivity: vi.fn()
        });

        expect(runtime.canSendAlerts()).toBe(true);
    });

    it('posts a new alert to the configured Slack webhook', async () => {
        const recordActivity = vi.fn();
        const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
            expect(url).toBe('https://hooks.slack.com/services/demo');
            expect(init?.headers).toEqual({ 'Content-Type': 'application/json' });
            const payload = JSON.parse(String(init?.body ?? '{}'));
            expect(payload.text).toContain('IBMEye alert: MSGW detected');
            expect(payload.attachments).toHaveLength(1);
            expect(payload.attachments[0].blocks).toEqual(expect.arrayContaining([
                expect.objectContaining({ type: 'header' }),
                expect.objectContaining({ type: 'context' })
            ]));
            return new Response('ok', { status: 200 });
        });

        const runtime = createSlackRuntime({
            getSettings: () => ({
                ...DEFAULT_SLACK_SETTINGS,
                enabled: true,
                webhookUrl: 'https://hooks.slack.com/services/demo',
                channelName: '#ibmi-ops'
            }),
            recordActivity,
            fetchImpl: fetchImpl as typeof fetch
        });

        await runtime.sendAlert({
            id: 'msgw:123/DEMO/JOB',
            kind: 'messageWait',
            severity: 'critical',
            timestamp: '2026-08-30T09:00:00.000Z',
            title: 'MSGW detected',
            message: 'QINTER/DEMOJOB entered message wait.',
            jobName: '123/DEMO/JOB',
            workflowStatus: 'new',
            notes: [],
            timeline: [],
            workflowUpdatedAt: '2026-08-30T09:00:00.000Z'
        });

        expect(recordActivity).toHaveBeenCalledWith(expect.objectContaining({
            message: 'Sent alert to Slack.',
            detail: 'Channel: #ibmi-ops'
        }));
    });

    it('rejects non-Slack webhook endpoints', async () => {
        const runtime = createSlackRuntime({
            getSettings: () => ({
                ...DEFAULT_SLACK_SETTINGS,
                enabled: true,
                webhookUrl: 'https://example.com/webhook'
            }),
            recordActivity: vi.fn(),
            fetchImpl: vi.fn()
        });

        await expect(runtime.sendTestMessage()).rejects.toThrow('Use an HTTPS Slack incoming webhook URL');
    });
});
