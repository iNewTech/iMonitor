import { describe, expect, it } from 'vitest';
import {
    DEFAULT_ALERT_SETTINGS,
    normalizeAlertSettings,
    shouldWatchAlert,
    shouldCreateClickUpTask,
    sortAlerts,
    type MonitorAlert
} from './alert-model';

function createAlert(overrides: Partial<MonitorAlert>): MonitorAlert {
    return {
        id: 'alert-1',
        kind: 'messageWait',
        severity: 'warning',
        timestamp: '2026-08-28T10:00:00.000Z',
        isActive: true,
        title: 'Alert',
        message: 'Alert message',
        workflowStatus: 'new',
        notes: [],
        timeline: [],
        workflowUpdatedAt: '2026-08-28T10:00:00.000Z',
        ...overrides
    };
}

describe('alert-model', () => {
    it('defaults ClickUp tickets to operator-impacting alert types', () => {
        expect(DEFAULT_ALERT_SETTINGS.createClickUpForMessageWait).toBe(true);
        expect(DEFAULT_ALERT_SETTINGS.createClickUpForLockWait).toBe(true);
        expect(DEFAULT_ALERT_SETTINGS.createClickUpForHighCpu).toBe(true);
        expect(DEFAULT_ALERT_SETTINGS.createClickUpForDelayWait).toBe(false);
        expect(DEFAULT_ALERT_SETTINGS.createClickUpForDequeueWait).toBe(false);
        expect(DEFAULT_ALERT_SETTINGS.createClickUpForPollFailure).toBe(false);
        expect(shouldCreateClickUpTask(DEFAULT_ALERT_SETTINGS, 'messageWait')).toBe(true);
        expect(shouldCreateClickUpTask(DEFAULT_ALERT_SETTINGS, 'lockWait')).toBe(true);
        expect(shouldCreateClickUpTask(DEFAULT_ALERT_SETTINGS, 'highCpu')).toBe(true);
        expect(shouldCreateClickUpTask(DEFAULT_ALERT_SETTINGS, 'delayWait')).toBe(false);
    });

    it('normalizes new wait watchers and ClickUp rules from older settings', () => {
        expect(normalizeAlertSettings({ watchMessageWait: false })).toEqual({
            ...DEFAULT_ALERT_SETTINGS,
            watchMessageWait: false
        });
    });

    it('defaults and clamps the high CPU recovery poll count', () => {
        expect(normalizeAlertSettings(undefined).highCpuRecoveryPolls).toBe(3);
        expect(normalizeAlertSettings({ highCpuRecoveryPolls: 0 }).highCpuRecoveryPolls).toBe(1);
        expect(normalizeAlertSettings({ highCpuRecoveryPolls: 25 }).highCpuRecoveryPolls).toBe(10);
    });

    it('uses the shared watch rules for every notification channel', () => {
        expect(shouldWatchAlert(DEFAULT_ALERT_SETTINGS, 'messageWait')).toBe(true);
        expect(shouldWatchAlert(DEFAULT_ALERT_SETTINGS, 'pollFailure')).toBe(true);
        expect(shouldWatchAlert({ ...DEFAULT_ALERT_SETTINGS, watchHighCpu: false }, 'highCpu')).toBe(false);
        expect(shouldWatchAlert({ ...DEFAULT_ALERT_SETTINGS, watchFailedPolls: false }, 'pollFailure')).toBe(false);
    });

    it('keeps active alerts first and orders each section from oldest to newest', () => {
        const alerts = sortAlerts([
            createAlert({
                id: 'active-newest',
                timestamp: '2026-08-28T10:10:00.000Z',
                isActive: true
            }),
            createAlert({
                id: 'resolved-oldest',
                timestamp: '2026-08-28T10:01:00.000Z',
                resolvedAt: '2026-08-28T10:15:00.000Z',
                isActive: false,
                workflowStatus: 'system_cleared'
            }),
            createAlert({
                id: 'active-oldest',
                timestamp: '2026-08-28T10:00:00.000Z',
                isActive: true
            }),
            createAlert({
                id: 'resolved-newest',
                timestamp: '2026-08-28T10:02:00.000Z',
                resolvedAt: '2026-08-28T10:20:00.000Z',
                isActive: false,
                workflowStatus: 'system_cleared'
            })
        ]);

        expect(alerts.map((alert) => alert.id)).toEqual([
            'active-oldest',
            'active-newest',
            'resolved-oldest',
            'resolved-newest'
        ]);
    });
});
