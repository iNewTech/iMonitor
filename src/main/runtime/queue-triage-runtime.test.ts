import { describe, expect, it } from 'vitest';
import { createQueueTriageRuntime } from './queue-triage-runtime';
import type { JobQueueRecord, QueuedJobRecord } from '../../services/ibmi';

function queue(overrides: Partial<JobQueueRecord> = {}): JobQueueRecord {
    return {
        JOB_QUEUE_NAME: 'QARCHIVE', JOB_QUEUE_LIBRARY: 'QGPL', JOB_QUEUE_STATUS: 'HELD',
        SUBSYSTEM_NAME: 'QSYSWRK', SUBSYSTEM_LIBRARY_NAME: 'QSYS', SEQUENCE_NUMBER: 1,
        OPERATOR_CONTROLLED: 'YES', WAITING_JOBS: 1, ACTIVE_JOBS: 0, MAX_ACTIVE_JOBS: 10,
        HELD_JOBS: 1, TEXT_DESCRIPTION: 'Archive work', OLDEST_WAIT_TIME: null, ...overrides
    };
}

function queuedJob(): QueuedJobRecord {
    return {
        JOB_NAME: '123/QUSER/REPORT01', JOB_NAME_SHORT: 'REPORT01', JOB_NUMBER: '123', JOB_USER: 'QUSER',
        JOB_STATUS: 'JOBQ', JOB_TYPE: 'BATCH', JOB_TYPE_ENHANCED: 'BATCH', JOB_QUEUE_NAME: 'QARCHIVE',
        JOB_QUEUE_LIBRARY: 'QGPL', JOB_QUEUE_STATUS: 'HELD', JOB_QUEUE_PRIORITY: 5, JOB_QUEUE_TIME: null,
        JOB_ENTERED_SYSTEM_TIME: null, SUBSYSTEM: 'QSYSWRK', SUBSYSTEM_LIBRARY_NAME: 'QSYS'
    };
}

function createTestRuntime(overrides: Partial<Parameters<typeof createQueueTriageRuntime>[0]> = {}) {
    const saved: Record<string, unknown> = {};
    const dependencies = {
        initialResults: {},
        getJobQueues: async () => ({ data: [queue()], hasMore: false, nextCursor: null }),
        getQueuedJobs: async () => ({ data: [queuedJob()], hasMore: false, nextCursor: null }),
        getJobQueueDetails: async () => ({ queue: {}, subsystem: { STATUS: 'ACTIVE' } }),
        persistResults: (results: unknown) => Object.assign(saved, results as Record<string, unknown>),
        sendToWindow: () => {},
        recordActivity: () => {},
        ...overrides
    };
    return { runtime: createQueueTriageRuntime(dependencies), saved, dependencies };
}

describe('read-only queue triage runtime', () => {
    it('collects queue, waiting-job, and subsystem evidence without a mutation dependency', async () => {
        const { runtime } = createTestRuntime();
        await runtime.runForHeldQueues();
        const result = runtime.getResults()[0];
        expect(result).toMatchObject({ status: 'completed', queueKey: 'QGPL/QARCHIVE', waitingJobs: 1 });
        expect(result.checks.map((check) => check.id)).toEqual(['queue-state', 'waiting-jobs', 'subsystem']);
        expect(result.stopReason).toContain('before any queue or job mutation');
    });

    it('records a clear outcome when no held queue is returned', async () => {
        const { runtime } = createTestRuntime({ getJobQueues: async () => ({ data: [], hasMore: false, nextCursor: null }) });
        await runtime.runForHeldQueues();
        expect(runtime.getResults()).toEqual([]);
    });

    it('stops with a partial result when subsystem context is unavailable', async () => {
        const { runtime } = createTestRuntime({ getJobQueueDetails: async () => ({ queue: {}, subsystem: null }) });
        await runtime.runForHeldQueues();
        expect(runtime.getResults()[0]).toMatchObject({ status: 'partial', checks: expect.arrayContaining([
            expect.objectContaining({ id: 'subsystem', status: 'unavailable' })
        ]) });
    });

    it('restarts triage when queue evidence changes', async () => {
        let current = queue();
        const { runtime } = createTestRuntime({
            getJobQueues: async () => ({ data: [current], hasMore: false, nextCursor: null }),
            getQueuedJobs: async () => ({
                data: Array.from({ length: current.WAITING_JOBS }, queuedJob), hasMore: false, nextCursor: null
            })
        });
        await runtime.runForHeldQueues();
        current = queue({ WAITING_JOBS: 4 });
        await runtime.runForHeldQueues();
        expect(runtime.getResults()[0].waitingJobs).toBe(4);
    });

    it('resumes an interrupted procedure from its saved next check', async () => {
        const first = queue();
        const { runtime } = createTestRuntime({
            initialResults: {
                'QGPL/QARCHIVE': {
                    schema: 'imonitor-queue-triage', version: 1, queueKey: 'QGPL/QARCHIVE', queueName: 'QARCHIVE', queueLibrary: 'QGPL',
                    status: 'running', startedAt: '2026-09-12T00:00:00.000Z', completedAt: null, updatedAt: '2026-09-12T00:00:00.000Z',
                    nextCheck: 'waiting-jobs', evidenceSignature: 'HELD|1|1|QSYSWRK|QSYS|—', waitingJobs: 1,
                    subsystemName: 'QSYSWRK', subsystemLibrary: 'QSYS', checks: [{ id: 'queue-state', label: 'Queue state', status: 'passed', summary: 'held', recordCount: 1, observedAt: '2026-09-12T00:00:00.000Z' }],
                    expectedOutcome: 'resume', stopReason: 'resume', proposedNextSteps: []
                }
            }
        });
        await runtime.runForHeldQueues();
        expect(runtime.getResults()[0].checks.map((check) => check.id)).toEqual(['queue-state', 'waiting-jobs', 'subsystem']);
        expect(first.JOB_QUEUE_STATUS).toBe('HELD');
    });
});
