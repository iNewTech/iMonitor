import { describe, expect, it } from 'vitest';
import type { ActiveJobRecord } from '../../services/ibmi';
import type { MonitorAlert } from '../alerts/alert-model';
import {
    attachIncidentCorrelations,
    buildIncidentCorrelations,
    INCIDENT_CORRELATION_WINDOW_MS
} from './incident-correlation';

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

    it('keeps similar messages on different jobs separate', () => {
        const message = 'The job is waiting for an operator response.';
        const incidents = buildIncidentCorrelations([
            createAlert({ message, jobName: '123456/QUSER/ORDERJOB' }),
            createAlert({
                id: 'msgw:999/QUSER/OTHERJOB',
                message,
                jobName: '999/QUSER/OTHERJOB'
            })
        ], [createJob(), createJob({
            JOB_NAME: '999/QUSER/OTHERJOB',
            JOB_NAME_SHORT: 'OTHERJOB',
            SUBSYSTEM_JOB: 'QINTER/OTHERJOB'
        })], 80);

        expect(incidents).toHaveLength(2);
        expect(incidents.every((incident) => incident.affectedJobs.length === 1)).toBe(true);
    });

    it('starts a new group outside the correlation time window', () => {
        const incidents = buildIncidentCorrelations([
            createAlert({ timestamp: '2026-09-02T10:00:00.000Z' }),
            createAlert({
                id: 'cpu:123456/QUSER/ORDERJOB',
                kind: 'highCpu',
                severity: 'warning',
                title: 'High CPU job detected',
                timestamp: new Date(Date.parse('2026-09-02T10:00:00.000Z') + INCIDENT_CORRELATION_WINDOW_MS + 1).toISOString()
            })
        ], [createJob()], 80);

        expect(incidents).toHaveLength(2);
        expect(incidents.every((incident) => incident.groupReason.includes('One active signal'))).toBe(true);
    });

    it('attaches a compact priority explanation to every grouped alert', () => {
        const alerts = [
            createAlert(),
            createAlert({
                id: 'cpu:123456/QUSER/ORDERJOB',
                kind: 'highCpu',
                severity: 'warning',
                occurrence: 4
            })
        ];
        const [first, second] = attachIncidentCorrelations(alerts, [createJob()], 80);

        expect(first?.correlation).toEqual(second?.correlation);
        expect(first?.correlation?.priority.score).toBeGreaterThan(50);
        expect(first?.correlation?.priority.reasons.join(' ')).toContain('Recurring condition (4 occurrences).');
        expect(first?.correlation?.priority.businessImpactMapped).toBe(false);
    });

    it('uses a stable fingerprint to break equal priority ties', () => {
        const incidents = buildIncidentCorrelations([
            createAlert({ id: 'z-alert', jobName: '123456/QUSER/ZJOB' }),
            createAlert({ id: 'a-alert', jobName: '999/QUSER/AJOB' })
        ], [
            createJob({ JOB_NAME: '123456/QUSER/ZJOB', JOB_NAME_SHORT: 'ZJOB', SUBSYSTEM_JOB: 'QINTER/ZJOB' }),
            createJob({ JOB_NAME: '999/QUSER/AJOB', JOB_NAME_SHORT: 'AJOB', SUBSYSTEM_JOB: 'QINTER/AJOB' })
        ], 80);

        expect(incidents[0]?.fingerprint.localeCompare(incidents[1]?.fingerprint || '')).toBeLessThan(0);
    });

    it('marks system-only matches as suggestions for review', () => {
        const incidents = buildIncidentCorrelations([
            createAlert({ jobName: undefined }),
            createAlert({ id: 'poll-2', jobName: undefined })
        ], [], 80);

        expect(incidents[0]?.suggested).toBe(true);
        expect(incidents[0]?.groupReason).toContain('operator review');
    });
});
