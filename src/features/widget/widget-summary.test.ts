import { describe, expect, it } from 'vitest';
import { buildWidgetSummary } from './widget-summary';
import type { ActiveJobRecord } from '../../services/ibmi';

function job(overrides: Partial<ActiveJobRecord>): ActiveJobRecord {
    return {
        JOB_NAME: null,
        JOB_NAME_SHORT: null,
        JOB_NUMBER: null,
        JOB_USER: null,
        SUBSYSTEM: null,
        SUBSYSTEM_LIBRARY_NAME: null,
        SUBSYSTEM_JOB: null,
        CURRENT_USER: null,
        TYPE: null,
        CPU: null,
        CPU_TIME: null,
        ELAPSED_CPU_TIME: null,
        FUNCTION_NAME: null,
        STATUS: null,
        THREAD_COUNT: null,
        TEMPORARY_STORAGE: null,
        TOTAL_DISK_IO_COUNT: null,
        ELAPSED_TOTAL_DISK_IO_COUNT: null,
        MESSAGE_REPLY: null,
        DATABASE_LOCK_WAITS: null,
        DATABASE_LOCK_WAIT_TIME: null,
        NON_DATABASE_LOCK_WAITS: null,
        NON_DATABASE_LOCK_WAIT_TIME: null,
        INTERNAL_MACHINE_LOCK_WAITS: null,
        INTERNAL_MACHINE_LOCK_WAIT_TIME: null,
        SQL_STATEMENT_TEXT: null,
        SQL_STATEMENT_STATUS: null,
        SQL_STATEMENT_START_TIMESTAMP: null,
        ...overrides
    };
}

describe('buildWidgetSummary', () => {
    it('summarizes live jobs and active alert data for the macOS widget', () => {
        const summary = buildWidgetSummary({
            generatedAt: '2026-09-08T13:20:00.000Z',
            active: true,
            connection: {
                name: 'Demo connection',
                host: 'dummy',
                user: 'GajenderT',
                port: 8076
            },
            jobs: [
                job({
                    JOB_NAME: '552901/BATCHNGT/NIGHTBCH',
                    SUBSYSTEM_JOB: 'QBATCH/NIGHTBCH',
                    STATUS: 'RUN',
                    CPU: '84.1',
                    FUNCTION_NAME: 'Posting invoices'
                }),
                job({
                    JOB_NAME: '843001/MFGUSR/MRPLOCK',
                    SUBSYSTEM_JOB: 'QUSRWRK/MRPLOCK',
                    STATUS: 'LCKW',
                    CPU: '18.4'
                })
            ],
            alerts: [{
                id: 'high-cpu-552901',
                kind: 'highCpu',
                severity: 'warning',
                timestamp: '2026-09-08T13:19:00.000Z',
                title: 'High CPU detected',
                message: 'QBATCH/NIGHTBCH is using 84.1% CPU.',
                jobName: '552901/BATCHNGT/NIGHTBCH',
                workflowStatus: 'claimed',
                owner: 'GajenderT',
                notes: [],
                timeline: [],
                workflowUpdatedAt: '2026-09-08T13:19:00.000Z'
            }]
        });

        expect(summary.status).toEqual({
            label: 'Live',
            healthy: false,
            detail: '1 active issue'
        });
        expect(summary.metrics).toMatchObject({
            totalJobs: 2,
            runningJobs: 1,
            waitingJobs: 1,
            lockWaitJobs: 1,
            peakCpu: 84.1
        });
        expect(summary.topIssue).toMatchObject({
            title: 'High CPU detected',
            owner: 'GajenderT'
        });
    });
});
