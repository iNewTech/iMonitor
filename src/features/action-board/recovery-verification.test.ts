import { describe, expect, it } from 'vitest';
import { buildQueueRecoveryVerification } from './recovery-verification';
import type { JobQueueRecord, QueuedJobRecord } from '../../services/ibmi';

const queue = (status: string, waiting = 0): JobQueueRecord => ({
    JOB_QUEUE_NAME: 'QGPLQ', JOB_QUEUE_LIBRARY: 'QGPL', JOB_QUEUE_STATUS: status,
    SUBSYSTEM_NAME: 'QBATCH', SUBSYSTEM_LIBRARY_NAME: 'QSYS', SEQUENCE_NUMBER: null,
    OPERATOR_CONTROLLED: null, WAITING_JOBS: waiting, ACTIVE_JOBS: 0, MAX_ACTIVE_JOBS: 10,
    HELD_JOBS: 0, TEXT_DESCRIPTION: null, OLDEST_WAIT_TIME: null
});

const queuedJob = (status: string): QueuedJobRecord => ({
    JOB_NAME: '1/USER/JOB', JOB_NAME_SHORT: 'JOB', JOB_NUMBER: '1', JOB_USER: 'USER',
    JOB_STATUS: 'JOBQ', JOB_TYPE: 'BATCH', JOB_TYPE_ENHANCED: 'BATCH', JOB_QUEUE_NAME: 'QGPLQ',
    JOB_QUEUE_LIBRARY: 'QGPL', JOB_QUEUE_STATUS: status, JOB_QUEUE_PRIORITY: 1, JOB_QUEUE_TIME: null,
    JOB_ENTERED_SYSTEM_TIME: null, SUBSYSTEM: 'QBATCH', SUBSYSTEM_LIBRARY_NAME: 'QSYS'
});

describe('queue recovery verification', () => {
    it('separates a released queue from waiting work that remains blocked', () => {
        const result = buildQueueRecoveryVerification({ kind: 'releaseQueue', queueName: 'QGPLQ', queueLibrary: 'QGPL' }, queue('RELEASED', 2), null, 2);
        expect(result).toMatchObject({ status: 'still-blocked' });
        expect(result.summary).toContain('2 waiting jobs remain');
    });

    it('reports a released queue with no waiting work as recovered', () => {
        expect(buildQueueRecoveryVerification({ kind: 'releaseQueue', queueName: 'QGPLQ', queueLibrary: 'QGPL' }, queue('RELEASED'), null, 0).status).toBe('recovered');
    });

    it('verifies queued-job actions against the job state', () => {
        const result = buildQueueRecoveryVerification({ kind: 'holdQueuedJob', queueName: 'QGPLQ', queueLibrary: 'QGPL', jobName: '1/USER/JOB' }, queue('RELEASED'), { ...queuedJob('HELD'), JOB_STATUS: 'HELD' }, 1);
        expect(result.status).toBe('recovered');
    });

    it('keeps an unavailable target explicitly unknown', () => {
        const result = buildQueueRecoveryVerification({ kind: 'releaseQueue', queueName: 'QGPLQ', queueLibrary: 'QGPL' }, null, null, 0);
        expect(result.status).toBe('unknown');
    });
});
