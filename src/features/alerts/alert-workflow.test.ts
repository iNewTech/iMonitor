import { describe, expect, it, vi } from 'vitest';
import { createPollFailureAlert, evaluateAlertRules } from './alert-workflow';
import type { AlertSettings } from './alert-model';
import type { ActiveJobRecord } from '../../services/ibmi';

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
    watchMessageWait: true,
    watchLockWait: true,
    watchFailedPolls: true,
    watchDisconnects: true
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

    it('creates or refreshes the poll failure alert with workflow state', () => {
        const failure = createPollFailureAlert('Socket timeout', [], new Set<string>(), {});

        expect(failure).not.toBeNull();
        expect(failure?.alert.workflowStatus).toBe('new');
        expect(failure?.workflowState.status).toBe('new');
        expect(failure?.alert.kind).toBe('pollFailure');
    });
});
