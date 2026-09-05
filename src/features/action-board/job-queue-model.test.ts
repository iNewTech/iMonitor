import { describe, expect, it } from 'vitest';
import {
    decodeCursor,
    encodeCursor,
    normalizeJobQueueRecord,
    normalizeQueuedJobRecord,
    normalizePageSize
} from './job-queue-model';

describe('job queue data model', () => {
    it('normalizes live and demo queue column names to one UI shape', () => {
        expect(normalizeJobQueueRecord({
            JOB_QUEUE_NAME: 'QBATCH',
            JOB_QUEUE_LIBRARY: 'QGPL',
            JOB_QUEUE_STATUS: 'RELEASED',
            SUBSYSTEM_NAME: 'QBATCH',
            SUBSYSTEM_LIBRARY_NAME: 'QSYS',
            SEQUENCE_NUMBER: '4',
            OPERATOR_CONTROLLED: 'NO',
            ACTIVE_JOBS: '4',
            MAX_ACTIVE_JOBS: 10,
            CURRENT_JOBS: 2
        })).toMatchObject({
            JOB_QUEUE_NAME: 'QBATCH',
            JOB_QUEUE_STATUS: 'RELEASED',
            WAITING_JOBS: 2,
            ACTIVE_JOBS: 4,
            MAX_ACTIVE_JOBS: 10,
            SUBSYSTEM_NAME: 'QBATCH',
            SUBSYSTEM_LIBRARY_NAME: 'QSYS',
            SEQUENCE_NUMBER: 4,
            OPERATOR_CONTROLLED: 'NO'
        });
    });

    it('normalizes queued jobs and preserves the fields needed for actions', () => {
        expect(normalizeQueuedJobRecord({
            JOB_NAME: '731002/QBATCH/NIGHTPOST',
            JOB_NAME_SHORT: 'NIGHTPOST',
            JOB_QUEUE_NAME: 'QBATCH',
            JOB_QUEUE_LIBRARY: 'QGPL',
            JOB_QUEUE_STATUS: 'RELEASED',
            JOB_QUEUE_PRIORITY: '5',
            JOB_STATUS: 'JOBQ'
        })).toMatchObject({
            JOB_NAME: '731002/QBATCH/NIGHTPOST',
            JOB_QUEUE_PRIORITY: 5,
            JOB_STATUS: 'JOBQ'
        });
    });

    it('bounds page sizes and safely round-trips cursors', () => {
        expect(normalizePageSize(1000)).toBe(100);
        expect(normalizePageSize(0)).toBe(1);
        const cursor = encodeCursor({ library: 'QGPL', name: 'QBATCH' });
        expect(decodeCursor(cursor)).toEqual({ library: 'QGPL', name: 'QBATCH' });
        expect(decodeCursor('not-a-cursor')).toBeNull();
    });
});
