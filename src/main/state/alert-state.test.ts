import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_ALERT_SETTINGS } from '../../features/alerts/alert-model';
import { createAlertStateStore } from './alert-state';

describe('alert-state external recovery notifications', () => {
    it('notifies the integration boundary once when a condition clears', () => {
        const onAlertResolved = vi.fn();
        const store = createAlertStateStore({
            initialWorkflowStateByAlertId: {},
            initialIncidentLedger: {},
            persistWorkflowState: vi.fn(),
            persistIncidentLedger: vi.fn(),
            getIncidentScope: () => ({ systemId: 'system-1', systemLabel: 'Demo system' }),
            onAlertsChanged: vi.fn(),
            onAlertResolved
        });

        store.evaluateAlertRules(
            [{ JOB_NAME: '123/USER/JOB', STATUS: 'MSGW', CPU: '1' } as never],
            '2026-09-12T10:00:00.000Z',
            DEFAULT_ALERT_SETTINGS,
            vi.fn()
        );
        expect(store.getActiveAlerts()).toHaveLength(1);
        expect(store.getActiveAlerts()[0]?.correlation?.priority.score).toBeGreaterThan(0);
        expect(store.getActiveAlerts()[0]?.correlation?.relatedSignals).toContain('message wait');

        store.evaluateAlertRules(
            [],
            '2026-09-12T10:00:05.000Z',
            DEFAULT_ALERT_SETTINGS,
            vi.fn()
        );

        expect(onAlertResolved).toHaveBeenCalledTimes(1);
        expect(onAlertResolved).toHaveBeenCalledWith(expect.objectContaining({
            id: expect.stringContaining('msgw:'),
            isActive: false,
            resolutionSource: 'automatic'
        }));
    });
});
