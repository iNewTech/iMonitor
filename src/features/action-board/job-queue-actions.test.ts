import { describe, expect, it } from 'vitest';
import {
    buildJobQueueActionPlan,
    requiresJobQueueConfirmation
} from './job-queue-actions';

describe('job queue action plans', () => {
    it('builds safe hold and release commands for queues and queued jobs', () => {
        expect(buildJobQueueActionPlan({
            kind: 'holdQueue',
            queueName: 'QARCHIVE',
            queueLibrary: 'QGPL'
        }).command).toBe('HLDJOBQ JOBQ(QGPL/QARCHIVE)');
        expect(buildJobQueueActionPlan({
            kind: 'releaseQueuedJob',
            queueName: 'QBATCH',
            queueLibrary: 'QGPL',
            jobName: '731002/QBATCH/NIGHTPOST'
        }).command).toBe('RLSJOB JOB(731002/QBATCH/NIGHTPOST)');
    });

    it('blocks unsafe object names instead of passing them to CL', () => {
        const plan = buildJobQueueActionPlan({
            kind: 'holdQueue',
            queueName: 'QGPL); DLTLIB QGPL',
            queueLibrary: 'QGPL'
        });

        expect(plan.executionType).toBe('blocked');
        expect(plan.command).toBeUndefined();
    });

    it('requires explicit confirmation for every mutating queue action', () => {
        expect(requiresJobQueueConfirmation('holdQueue')).toBe(true);
        expect(requiresJobQueueConfirmation('releaseQueue')).toBe(true);
        expect(requiresJobQueueConfirmation('holdQueuedJob')).toBe(true);
        expect(requiresJobQueueConfirmation('releaseQueuedJob')).toBe(true);
    });
});
