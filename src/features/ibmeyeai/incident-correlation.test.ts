import { describe, expect, it } from 'vitest';
import type { ActiveJobRecord } from '../../services/ibmi';
import type { MonitorAlert } from '../alerts/alert-model';
import { buildIncidentCorrelations } from './incident-correlation';

function createJob(overrides: Partial<ActiveJobRecord> = {}): ActiveJobRecord {
    return {
        JOB_NAME: '123456/QUSER/ORDERJOB',
        JOB_NAME_SHORT: 'ORDERJOB',
        JOB_NUMBER: '123456',
        JOB_USER: 'QUSER',
        SUBSYSTEM: 'QINTER',
        SUBSYSTEM_LIBRARY_NAME: 'QSYS',
        SUBSYSTEM_JOB: 'QINTER/ORDERJOB',
        CURRENT_USER: 'QUSER',
        TYPE: 'BATCH',
        CPU: 86,
        CPU_TIME: 0,
        ELAPSED_CPU_TIME: 0,
        FUNCTION_NAME: 'Order processing',
        STATUS: 'LCKW',
        THREAD_COUNT: 1,
        TEMPORARY_STORAGE: 0,
        TOTAL_DISK_IO_COUNT: 0,
        ELAPSED_TOTAL_DISK_IO_COUNT: 0,
        MESSAGE_REPLY: 'NO',
        DATABASE_LOCK_WAITS: 2,
        DATABASE_LOCK_WAIT_TIME: 1400,
        NON_DATABASE_LOCK_WAITS: 0,
        NON_DATABASE_LOCK_WAIT_TIME: 0,
        INTERNAL_MACHINE_LOCK_WAITS: 0,
        INTERNAL_MACHINE_LOCK_WAIT_TIME: 0,
        SQL_STATEMENT_TEXT: 'update orders set status = ?',
        SQL_STATEMENT_STATUS: 'RUNNING',
        SQL_STATEMENT_START_TIMESTAMP: '2026-09-02T10:00:00.000Z',
        ...overrides
    };
}

function createAlert(overrides: Partial<MonitorAlert> = {}): MonitorAlert {
    return {
        id: 'lckw:123456/QUSER/ORDERJOB',
        kind: 'lockWait',
        severity: 'critical',
        timestamp: '2026-09-02T10:00:00.000Z',
        title: 'LCKW detected',
        message: 'QINTER/ORDERJOB is waiting on a lock.',
        detail: 'Database waits: 2',
        jobName: '123456/QUSER/ORDERJOB',
        workflowStatus: 'new',
        notes: [],
        timeline: [],
        workflowUpdatedAt: '2026-09-02T10:00:00.000Z',
        isActive: true,
        ...overrides
    };
}

describe('incident-correlation', () => {
    it('groups alerts for one job and adds evidence plus guided next action', () => {
        const incidents = buildIncidentCorrelations([
            createAlert(),
            createAlert({
                id: 'cpu:123456/QUSER/ORDERJOB',
                kind: 'highCpu',
                severity: 'warning',
                title: 'High CPU job detected',
                message: 'QINTER/ORDERJOB reached 86% CPU.'
            })
        ], [createJob()], 80);

        expect(incidents).toHaveLength(1);
        expect(incidents[0]?.alertIds).toEqual([
            'lckw:123456/QUSER/ORDERJOB',
            'cpu:123456/QUSER/ORDERJOB'
        ]);
        expect(incidents[0]?.evidence.join(' ')).toContain('status=LCKW');
        expect(incidents[0]?.nextAction).toContain('blocking job');
    });

    it('does not correlate unrelated jobs and ignores cleared alerts', () => {
        const incidents = buildIncidentCorrelations([
            createAlert(),
            createAlert({
                id: 'msgw:999/QUSER/OTHERJOB',
                kind: 'messageWait',
                jobName: '999/QUSER/OTHERJOB',
                isActive: true
            }),
            createAlert({
                id: 'cpu:cleared',
                kind: 'highCpu',
                jobName: '123456/QUSER/ORDERJOB',
                isActive: false
            })
        ], [createJob()], 80);

        expect(incidents).toHaveLength(2);
        expect(incidents.every((incident) => incident.alertIds.length === 1)).toBe(true);
    });
});
