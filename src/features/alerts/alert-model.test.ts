import { describe, expect, it } from 'vitest';
import { sortAlerts, type MonitorAlert } from './alert-model';

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
