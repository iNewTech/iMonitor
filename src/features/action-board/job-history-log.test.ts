import { describe, expect, it } from 'vitest';
import { buildJobHistoryLog } from './job-history-log';

describe('buildJobHistoryLog', () => {
    it('keeps only the requested job from poll snapshots', () => {
        const result = buildJobHistoryLog('QINTER/MSGWJOB', [
            { timestamp: '2026-08-31T09:00:00.000Z', payload: { jobs: [
                { SUBSYSTEM_JOB: 'QINTER/MSGWJOB', STATUS: 'MSGW', CPU: 1.2, SQL_STATEMENT_STATUS: 'WAITING' },
                { SUBSYSTEM_JOB: 'QBATCH/OTHER', STATUS: 'RUN', CPU: 40 }
            ] } },
            { timestamp: '2026-08-31T09:05:00.000Z', payload: { jobs: [
                { SUBSYSTEM_JOB: 'QINTER/MSGWJOB', STATUS: 'RUN', CPU: 2.4 }
            ] } }
        ], (job) => String(job.SUBSYSTEM_JOB || ''));

        expect(result).toContain('[2026-08-31T09:00:00.000Z] QINTER/MSGWJOB status=MSGW cpu=1.20%');
        expect(result).toContain('[2026-08-31T09:05:00.000Z] QINTER/MSGWJOB status=RUN cpu=2.40%');
        expect(result).not.toContain('QBATCH/OTHER');
    });
});
