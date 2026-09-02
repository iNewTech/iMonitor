import { describe, expect, it, vi } from 'vitest';
import { createPollFailureAlert, evaluateAlertRules } from './alert-workflow';
import type { AlertSettings } from './alert-model';
import type { ActiveJobRecord } from '../../services/ibmi';
import { createAlertStateStore } from '../../main/state/alert-state';

function createJob(overrides: Partial<ActiveJobRecord>): ActiveJobRecord {
    return {
        JOB_NAME: '123456/DEMO/TESTJOB',
        JOB_NAME_SHORT: 'TESTJOB',
        JOB_NUMBER: '123456',
        JOB_USER: 'DEMO',
        SUBSYSTEM: 'QSYSWRK',
        SUBSYSTEM_LIBRARY_NAME: 'QSYS',
        SUBSYSTEM_JOB: 'QSYSWRK/TESTJOB',
        CURRENT_USER: 'DEMO',
        TYPE: 'BATCH',
        CPU: 0,
        CPU_TIME: 0,
        ELAPSED_CPU_TIME: 0,
        FUNCTION_NAME: 'Unit test workload',
        STATUS: 'RUN',
        THREAD_COUNT: 1,
        TEMPORARY_STORAGE: 64,
        TOTAL_DISK_IO_COUNT: 0,
        ELAPSED_TOTAL_DISK_IO_COUNT: 0,
        MESSAGE_REPLY: 'NO',
        DATABASE_LOCK_WAITS: 0,
        DATABASE_LOCK_WAIT_TIME: 0,
        NON_DATABASE_LOCK_WAITS: 0,
        NON_DATABASE_LOCK_WAIT_TIME: 0,
        INTERNAL_MACHINE_LOCK_WAITS: 0,
        INTERNAL_MACHINE_LOCK_WAIT_TIME: 0,
        SQL_STATEMENT_TEXT: 'select * from qsys2.active_job_info',
        SQL_STATEMENT_STATUS: 'RUNNING',
        SQL_STATEMENT_START_TIMESTAMP: '2026-08-23T12:00:00.000Z',
        ...overrides
    };
}

const settings: AlertSettings = {
    desktopNotifications: true,
    watchHighCpu: true,
    highCpuThreshold: 80,
    highCpuRecoveryPolls: 3,
    watchMessageWait: true,
    watchLockWait: true,
    watchDelayWait: true,
    watchDequeueWait: true,
    watchFailedPolls: true,
    watchDisconnects: true,
    createClickUpForHighCpu: true,
    createClickUpForMessageWait: true,
    createClickUpForLockWait: true,
    createClickUpForDelayWait: false,
    createClickUpForDequeueWait: false,
    createClickUpForPollFailure: false
};

describe('alert workflow evaluation', () => {
    it('creates a new MSGW alert with workflow state', () => {
        const notify = vi.fn();
        const result = evaluateAlertRules([
            createJob({ STATUS: 'MSGW', MESSAGE_REPLY: 'YES' })
        ], {
            activeAlerts: [],
            dismissedAlertIds: new Set<string>(),
            workflowStateByAlertId: {},
            settings,
            timestamp: '2026-08-23T12:00:00.000Z',
            notify
        });

        expect(result.alerts).toHaveLength(1);
        expect(result.alerts[0]?.workflowStatus).toBe('new');
        expect(result.alerts[0]?.timeline[0]?.action).toBe('created');
        expect(notify).toHaveBeenCalledTimes(1);
    });

    it('marks a tracked alert system cleared when the condition clears', () => {
        const notify = vi.fn();
        const initial = evaluateAlertRules([
            createJob({ STATUS: 'MSGW', MESSAGE_REPLY: 'YES' })
        ], {
            activeAlerts: [],
            dismissedAlertIds: new Set<string>(),
            workflowStateByAlertId: {},
            settings,
            timestamp: '2026-08-23T12:00:00.000Z',
            notify
        });

        const followUp = evaluateAlertRules([], {
            activeAlerts: initial.alerts,
            dismissedAlertIds: new Set<string>(),
            workflowStateByAlertId: initial.workflowStateByAlertId,
            settings,
            timestamp: '2026-08-23T12:01:00.000Z',
            notify
        });

        expect(followUp.alerts[0]?.isActive).toBe(false);
        expect(followUp.alerts[0]?.workflowStatus).toBe('system_cleared');
        expect(followUp.workflowStateByAlertId[followUp.alerts[0].id]?.status).toBe('system_cleared');
    });

    it('requires consecutive healthy polls before automatically resolving high CPU', () => {
        const first = evaluateAlertRules([createJob({ CPU: 92 })], {
            activeAlerts: [], dismissedAlertIds: new Set(), workflowStateByAlertId: {}, settings,
            timestamp: '2026-08-23T12:00:00.000Z', notify: vi.fn()
        });
        const second = evaluateAlertRules([createJob({ CPU: 20 })], {
            activeAlerts: first.alerts, dismissedAlertIds: new Set(),
            workflowStateByAlertId: first.workflowStateByAlertId, settings,
            timestamp: '2026-08-23T12:01:00.000Z', notify: vi.fn()
        });
        const third = evaluateAlertRules([createJob({ CPU: 18 })], {
            activeAlerts: second.alerts, dismissedAlertIds: new Set(),
            workflowStateByAlertId: second.workflowStateByAlertId, settings,
            timestamp: '2026-08-23T12:02:00.000Z', notify: vi.fn()
        });
        const fourth = evaluateAlertRules([createJob({ CPU: 16 })], {
            activeAlerts: third.alerts, dismissedAlertIds: new Set(),
            workflowStateByAlertId: third.workflowStateByAlertId, settings,
            timestamp: '2026-08-23T12:03:00.000Z', notify: vi.fn()
        });

        expect(second.alerts[0]).toMatchObject({ isActive: true, recoveryPollCount: 1 });
        expect(third.alerts[0]).toMatchObject({ isActive: true, recoveryPollCount: 2 });
        expect(fourth.alerts[0]).toMatchObject({
            isActive: false,
            recoveryPollCount: 3,
            resolutionSource: 'automatic'
        });
    });

    it('does not append duplicate automatic resolution events on later healthy polls', () => {
        const first = evaluateAlertRules([createJob({ STATUS: 'LCKW' })], {
            activeAlerts: [], dismissedAlertIds: new Set(), workflowStateByAlertId: {}, settings,
            timestamp: '2026-08-23T12:00:00.000Z', notify: vi.fn()
        });
        const cleared = evaluateAlertRules([createJob({ STATUS: 'RUN' })], {
            activeAlerts: first.alerts, dismissedAlertIds: new Set(),
            workflowStateByAlertId: first.workflowStateByAlertId, settings,
            timestamp: '2026-08-23T12:01:00.000Z', notify: vi.fn()
        });
        const later = evaluateAlertRules([createJob({ STATUS: 'RUN' })], {
            activeAlerts: cleared.alerts, dismissedAlertIds: new Set(),
            workflowStateByAlertId: cleared.workflowStateByAlertId, settings,
            timestamp: '2026-08-23T12:02:00.000Z', notify: vi.fn()
        });

        expect(later.alerts[0]?.timeline.filter((entry) => entry.action === 'system_cleared')).toHaveLength(1);
        expect(later.alerts[0]?.resolvedAt).toBe('2026-08-23T12:01:00.000Z');
    });

    it('starts a fresh occurrence when an automatically resolved alert returns', () => {
        const first = evaluateAlertRules([createJob({ STATUS: 'MSGW' })], {
            activeAlerts: [], dismissedAlertIds: new Set(), workflowStateByAlertId: {}, settings,
            timestamp: '2026-08-23T12:00:00.000Z', notify: vi.fn()
        });
        const cleared = evaluateAlertRules([createJob({ STATUS: 'RUN' })], {
            activeAlerts: first.alerts, dismissedAlertIds: new Set(),
            workflowStateByAlertId: first.workflowStateByAlertId, settings,
            timestamp: '2026-08-23T12:01:00.000Z', notify: vi.fn()
        });
        const returned = evaluateAlertRules([createJob({ STATUS: 'MSGW' })], {
            activeAlerts: cleared.alerts, dismissedAlertIds: new Set(),
            workflowStateByAlertId: cleared.workflowStateByAlertId, settings,
            timestamp: '2026-08-23T13:00:00.000Z', notify: vi.fn()
        });

        expect(returned.alerts[0]?.isActive).toBe(true);
        expect(returned.alerts[0]?.resolvedAt).toBeUndefined();
        expect(returned.alerts[0]?.timestamp).not.toBe(first.alerts[0]?.timestamp);
        expect(returned.alerts[0]?.timeline[0]?.action).toBe('reopened');
    });

    it('creates or refreshes the poll failure alert with workflow state', () => {
        const failure = createPollFailureAlert('Socket timeout', [], new Set<string>(), {});

        expect(failure).not.toBeNull();
        expect(failure?.alert.workflowStatus).toBe('new');
        expect(failure?.workflowState.status).toBe('new');
        expect(failure?.alert.kind).toBe('pollFailure');
    });

    it('creates optional DLYW and DEQW alerts when those watchers are enabled', () => {
        const result = evaluateAlertRules([
            createJob({ JOB_NAME: '1/DEMO/DLYW', STATUS: 'DLYW' }),
            createJob({ JOB_NAME: '2/DEMO/DEQW', STATUS: 'DEQW' })
        ], {
            activeAlerts: [],
            dismissedAlertIds: new Set<string>(),
            workflowStateByAlertId: {},
            settings,
            timestamp: '2026-08-23T12:00:00.000Z',
            notify: vi.fn()
        });

        expect(result.alerts.map((alert) => alert.kind)).toEqual(
            expect.arrayContaining(['dequeueWait', 'delayWait'])
        );
    });

    it('notifies when a brand-new alert is created', () => {
        const onAlertCreated = vi.fn();
        const alertStore = createAlertStateStore({
            initialWorkflowStateByAlertId: {},
            persistWorkflowState: vi.fn(),
            onAlertsChanged: vi.fn(),
            onAlertCreated
        });

        alertStore.evaluateAlertRules([
            createJob({ STATUS: 'MSGW', MESSAGE_REPLY: 'YES' })
        ], '2026-08-23T12:00:00.000Z', settings, vi.fn());

        expect(onAlertCreated).toHaveBeenCalledTimes(1);
        expect(onAlertCreated.mock.calls[0]?.[0]?.id).toBe('msgw:123456/DEMO/TESTJOB');
    });
});
