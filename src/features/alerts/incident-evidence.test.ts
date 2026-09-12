import { describe, expect, it } from 'vitest';
import type { ActiveJobRecord, JobLogRecord, JobMessageRecord } from '../../services/ibmi';
import type { MonitorAlert } from './alert-model';
import {
    captureIncidentEvidence,
    normalizeIncidentEvidence
} from './incident-evidence';

const alert = {
    id: 'system-a::msgw:123456/DEMO/ORDER01',
    kind: 'messageWait',
    severity: 'critical',
    timestamp: '2026-09-12T10:00:00.000Z',
    title: 'MSGW detected',
    message: 'A job is waiting for a message reply.',
    jobName: '123456/DEMO/ORDER01',
    workflowStatus: 'new',
    notes: [],
    timeline: [],
    workflowUpdatedAt: '2026-09-12T10:00:00.000Z'
} as MonitorAlert;

const triggerJob = {
    JOB_NAME: alert.jobName,
    STATUS: 'MSGW',
    CURRENT_USER: 'DEMO',
    SQL_STATEMENT_TEXT: 'password=do-not-store'
} as ActiveJobRecord;

describe('incident evidence capture', () => {
    it('captures bounded source snapshots and redacts secret-shaped fields', async () => {
        const evidence = await captureIncidentEvidence({
            alert,
            triggerJob,
            source: 'ibmi',
            systemId: 'system-a',
            systemLabel: 'Production A',
            collectors: {
                getJobContext: async () => ({
                    jobInfo: { JOB_NAME: alert.jobName, PASSWORD: 'secret-value' },
                    jobQueue: { JOB_QUEUE_NAME: 'QBATCH', STATUS: 'RELEASED' },
                    subsystem: { SUBSYSTEM_DESCRIPTION: 'QBATCH', STATUS: 'ACTIVE' }
                }),
                getJobLog: async () => [{
                    MESSAGE_ID: 'CPF1234',
                    MESSAGE_TEXT: 'token=hidden-value',
                    MESSAGE_TIMESTAMP: new Date().toISOString()
                } as JobLogRecord],
                getJobMessages: async () => [{
                    MESSAGE_ID: 'CPI9999',
                    MESSAGE_TEXT: 'Please reply to the job.',
                    MESSAGE_TIMESTAMP: new Date().toISOString()
                } as JobMessageRecord]
            }
        });

        expect(evidence).toMatchObject({
            version: 1,
            source: 'ibmi',
            systemId: 'system-a',
            trigger: { status: 'captured', recordCount: 1 },
            queue: { status: 'captured', recordCount: 1 },
            subsystem: { status: 'captured', recordCount: 1 },
            jobLog: { status: 'captured', recordCount: 1 },
            messages: { status: 'captured', recordCount: 1 }
        });
        expect(evidence.trigger.records[0]?.SQL_STATEMENT_TEXT).toBe('password=[REDACTED]');
        expect(evidence.job.records[0]?.PASSWORD).toBe('[REDACTED]');
        expect(evidence.jobLog.records[0]?.MESSAGE_TEXT).toBe('token=[REDACTED]');
    });

    it('keeps partial authority failures and timeouts explicit', async () => {
        const evidence = await captureIncidentEvidence({
            alert,
            triggerJob,
            source: 'demo',
            collectors: {
                getJobContext: async () => { throw new Error('Not authorized to read job context'); },
                getJobLog: async () => new Promise(() => undefined),
                getJobMessages: async () => new Promise(() => undefined)
            },
            budgetMs: 250
        });

        expect(evidence.source).toBe('demo');
        expect(evidence.queue.status).toBe('permission-denied');
        expect(evidence.subsystem.status).toBe('permission-denied');
        expect(evidence.jobLog.status).toBe('unavailable');
        expect(evidence.messages.status).toBe('unavailable');
        expect(evidence.jobLog.detail).toContain('timed out');
    });

    it('normalizes persisted snapshots and caps oversized records', () => {
        const normalized = normalizeIncidentEvidence({
            capturedAt: '2026-09-12T10:00:00.000Z',
            source: 'demo',
            trigger: {
                status: 'captured',
                collectedAt: '2026-09-12T10:00:00.000Z',
                records: Array.from({ length: 120 }, (_, index) => ({ index }))
            }
        });

        expect(normalized?.trigger.recordCount).toBe(100);
        expect(normalized?.queue.status).toBe('unavailable');
    });
});
