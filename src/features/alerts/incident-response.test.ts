import { describe, expect, it } from 'vitest';
import type { ActiveJobRecord } from '../../services/ibmi';
import type { MonitorAlert } from './alert-model';
import { buildIncidentResponseSnapshot } from './incident-response';

const job = {
    JOB_NAME: '123/OPERATOR/LOCKJOB',
    SUBSYSTEM_JOB: 'QBATCH/LOCKJOB',
    STATUS: 'LCKW',
    CPU: 12
} as ActiveJobRecord;

const alert = {
    id: 'lock-alert', incidentId: 'incident-1', jobName: job.JOB_NAME,
    kind: 'lockWait', severity: 'critical', title: 'LCKW detected',
    message: 'The job is waiting on a lock.', workflowStatus: 'claimed', owner: 'operator',
    notes: [], timeline: [{ id: 'claim', action: 'claimed', label: 'Work claimed', timestamp: '2026-09-12T10:00:00Z' }],
    workflowUpdatedAt: '2026-09-12T10:00:00Z', isActive: true, timestamp: '2026-09-12T10:00:00Z'
} as unknown as MonitorAlert;

describe('incident-response', () => {
    it('builds a focused response brief and handoff defaults', () => {
        const response = buildIncidentResponseSnapshot({
            job,
            alert,
            statusHistory: [{ timestamp: '2026-09-12T09:59:00Z', status: 'LCKW', label: 'Waiting for a lock' }]
        });

        expect(response).toMatchObject({
            schema: 'imonitor-incident-response',
            incidentKey: 'incident-1',
            step: 'investigate',
            impactLabel: 'Critical',
            owner: 'operator',
            status: 'claimed'
        });
        expect(response.nextCheck).toContain('blocking job');
        expect(response.completedChecks[0]).toContain('Waiting for a lock');
        expect(response.unresolvedQuestions).toHaveLength(2);
    });

    it('keeps a clear job actionable without inventing an incident', () => {
        const response = buildIncidentResponseSnapshot({ job, statusHistory: [] });

        expect(response.incidentTitle).toBe('No linked incident');
        expect(response.status).toBe('clear');
        expect(response.impactLabel).toBe('Critical');
        expect(response.unsuccessfulAttempts).toEqual(['No unsuccessful attempts recorded.']);
    });
});
