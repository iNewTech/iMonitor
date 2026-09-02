import { describe, expect, it } from 'vitest';
import type { ActiveJobRecord } from '../../services/ibmi';
import type { MonitorAlert } from './alert-model';
import { recheckAlertCondition } from './alert-recheck';
import { createAlertStateStore } from '../../main/state/alert-state';

function job(overrides: Partial<ActiveJobRecord> = {}): ActiveJobRecord {
    return {
        JOB_NAME: '123456/QUSER/DEMO', JOB_NAME_SHORT: 'DEMO', JOB_NUMBER: '123456', JOB_USER: 'QUSER',
        SUBSYSTEM: 'QBATCH', SUBSYSTEM_LIBRARY_NAME: 'QSYS', SUBSYSTEM_JOB: 'QBATCH/DEMO', CURRENT_USER: 'QUSER',
        TYPE: 'BATCH', CPU: 10, CPU_TIME: 1, ELAPSED_CPU_TIME: 1, FUNCTION_NAME: 'Demo', STATUS: 'MSGW',
        THREAD_COUNT: 1, TEMPORARY_STORAGE: 0, TOTAL_DISK_IO_COUNT: 0, ELAPSED_TOTAL_DISK_IO_COUNT: 0,
        MESSAGE_REPLY: 'YES', DATABASE_LOCK_WAITS: 0, DATABASE_LOCK_WAIT_TIME: 0, NON_DATABASE_LOCK_WAITS: 0,
        NON_DATABASE_LOCK_WAIT_TIME: 0, INTERNAL_MACHINE_LOCK_WAITS: 0, INTERNAL_MACHINE_LOCK_WAIT_TIME: 0,
        SQL_STATEMENT_TEXT: null, SQL_STATEMENT_STATUS: null, SQL_STATEMENT_START_TIMESTAMP: null, ...overrides
    };
}

function alert(overrides: Partial<MonitorAlert> = {}): MonitorAlert {
    return {
        id: 'msgw:QBATCH/DEMO', kind: 'messageWait', severity: 'critical', timestamp: '2026-08-31T09:00:00.000Z',
        title: 'MSGW detected', message: 'Demo is waiting', jobName: 'QBATCH/DEMO', workflowStatus: 'new',
        notes: [], timeline: [], workflowUpdatedAt: '2026-08-31T09:00:00.000Z', ...overrides
    };
}

describe('recheckAlertCondition', () => {
    it('keeps an alert active when the condition is still present', () => {
        expect(recheckAlertCondition(alert(), [job()], 80)).toBe('active');
    });

    it('reports cleared when the job disappeared or recovered', () => {
        expect(recheckAlertCondition(alert(), [job({ STATUS: 'RUN' })], 80)).toBe('cleared');
        expect(recheckAlertCondition(alert(), [], 80)).toBe('cleared');
    });

    it('does not guess for poll failures without a fresh poll result', () => {
        expect(recheckAlertCondition(alert({ kind: 'pollFailure', jobName: undefined }), [], 80)).toBe('unavailable');
    });

    it('uses the configured CPU threshold for high CPU alerts', () => {
        expect(recheckAlertCondition(alert({ id: 'cpu:QBATCH/DEMO', kind: 'highCpu' }), [job({ STATUS: 'RUN', CPU: 79 })], 80)).toBe('cleared');
        expect(recheckAlertCondition(alert({ id: 'cpu:QBATCH/DEMO', kind: 'highCpu' }), [job({ STATUS: 'RUN', CPU: 81 })], 80)).toBe('active');
    });

    it('records manual rechecks and immediately clears a recovered condition', () => {
        const store = createAlertStateStore({
            initialWorkflowStateByAlertId: {},
            persistWorkflowState: () => undefined,
            onAlertsChanged: () => undefined
        });
        store.setActiveAlerts([alert({
            isActive: true,
            timeline: [{
                id: 'created', timestamp: '2026-08-31T09:00:00.000Z', action: 'created', label: 'Alert created'
            }]
        })]);

        store.recordAlertRecheck('msgw:QBATCH/DEMO', 'cleared', '2026-08-31T09:05:00.000Z');

        expect(store.getActiveAlerts()[0]).toMatchObject({
            isActive: false,
            resolvedAt: '2026-08-31T09:05:00.000Z',
            resolutionSource: 'manual_recheck'
        });
        expect(store.getActiveAlerts()[0]?.timeline[0]?.action).toBe('rechecked');
    });
});
