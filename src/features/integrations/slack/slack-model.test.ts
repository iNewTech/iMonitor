import { describe, expect, it } from 'vitest';
import type { MonitorAlert } from '../../alerts/alert-model';
import {
    DEFAULT_SLACK_SETTINGS,
    buildSlackAlertMessage,
    buildSlackAlertPayload,
    normalizeSlackSettings,
    shouldSendSlackAlert
} from './slack-model';

describe('slack-model', () => {
    it('defaults Slack delivery to every alert type', () => {
        expect(shouldSendSlackAlert(DEFAULT_SLACK_SETTINGS, 'messageWait')).toBe(true);
        expect(shouldSendSlackAlert(DEFAULT_SLACK_SETTINGS, 'lockWait')).toBe(true);
        expect(shouldSendSlackAlert(DEFAULT_SLACK_SETTINGS, 'highCpu')).toBe(true);
        expect(shouldSendSlackAlert(DEFAULT_SLACK_SETTINGS, 'delayWait')).toBe(true);
        expect(shouldSendSlackAlert(DEFAULT_SLACK_SETTINGS, 'dequeueWait')).toBe(true);
        expect(shouldSendSlackAlert(DEFAULT_SLACK_SETTINGS, 'pollFailure')).toBe(true);
    });

    it('fills missing settings from safe defaults', () => {
        expect(normalizeSlackSettings({ webhookUrl: ' https://hooks.slack.com/services/demo ' })).toEqual({
            ...DEFAULT_SLACK_SETTINGS,
            webhookUrl: 'https://hooks.slack.com/services/demo'
        });
    });

    it('builds a readable alert message for the channel', () => {
        const alert: MonitorAlert = {
            id: 'msgw:123/DEMO/JOB',
            kind: 'messageWait',
            severity: 'critical',
            timestamp: '2026-08-30T09:00:00.000Z',
            title: 'MSGW detected',
            message: 'QINTER/DEMOJOB entered message wait.',
            detail: 'Waiting for an operator reply.',
            jobName: '123/DEMO/JOB',
            workflowStatus: 'new',
            notes: [],
            timeline: [],
            workflowUpdatedAt: '2026-08-30T09:00:00.000Z'
        };
        const message = buildSlackAlertMessage(alert);
        const payload = buildSlackAlertPayload(alert);

        expect(message).toContain('iMonitor alert: MSGW detected');
        expect(message).toContain('Job: 123/DEMO/JOB');
        expect(message).toContain('Waiting for an operator reply.');
        expect(payload.text).toContain('IBMEye alert: MSGW detected');
        expect(payload.attachments).toHaveLength(1);
        expect(payload.attachments[0].color).toBe('#C9433A');
        expect(payload.attachments[0].blocks[0]).toEqual(expect.objectContaining({
            type: 'header'
        }));
    });
});
