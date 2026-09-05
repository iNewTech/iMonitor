import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildDemoSnapshot } from '../utils/demo-system';
import { DemoDatabase } from './demo-db';

describe('demo database', () => {
    const temporaryDirectories: string[] = [];

    afterEach(() => {
        temporaryDirectories.splice(0).forEach((directory) => {
            rmSync(directory, { recursive: true, force: true });
        });
    });

    it('stores the demo snapshot in IBM i-shaped local tables', () => {
        const directory = mkdtempSync(join(tmpdir(), 'imonitor-demo-db-'));
        temporaryDirectories.push(directory);
        const database = new DemoDatabase(join(directory, 'demo.sqlite'));

        database.refresh(buildDemoSnapshot(1));

        const activeJobs = database.getActiveJobs();
        const msgwJob = activeJobs.data.find((job) => job.STATUS === 'MSGW');

        expect(activeJobs.data.length).toBeGreaterThanOrEqual(12);
        expect(activeJobs.generatedAt).toBeTruthy();
        expect(msgwJob?.JOB_NAME).toBeTruthy();
        expect(database.getJobContext(msgwJob?.JOB_NAME || '').jobQueue).toMatchObject({
            STATUS: 'RELEASED'
        });

        const queues = database.getJobQueues({ limit: 50 });
        expect(queues.data.length).toBeGreaterThanOrEqual(4);
        expect(queues.data.find((queue) => queue.JOB_QUEUE_NAME === 'QBATCH')).toMatchObject({
            WAITING_JOBS: 2,
            JOB_QUEUE_STATUS: 'RELEASED',
            SUBSYSTEM_NAME: 'QBATCH',
            SUBSYSTEM_LIBRARY_NAME: 'QSYS'
        });
        expect(database.getJobQueueDetails('QBATCH', 'QGPL')).toMatchObject({
            JOB_QUEUE_NAME: 'QBATCH',
            SUBSYSTEM_NAME: 'QBATCH',
            SUBSYSTEM_LIBRARY_NAME: 'QSYS'
        });
        expect(database.getSubsystemDetails('QBATCH', 'QSYS')).toMatchObject({
            STATUS: 'ACTIVE'
        });
        expect(Number(database.getSubsystemDetails('QBATCH', 'QSYS')?.CURRENT_ACTIVE_JOBS)).toBeGreaterThan(0);
        expect(database.getQueuedJobs({ queueName: 'QBATCH', queueLibrary: 'QGPL' }).data).toHaveLength(2);

        database.close();
    });

    it('serves job logs, message context, and system messages from the same database', () => {
        const directory = mkdtempSync(join(tmpdir(), 'imonitor-demo-db-'));
        temporaryDirectories.push(directory);
        const database = new DemoDatabase(join(directory, 'demo.sqlite'));
        database.refresh(buildDemoSnapshot(1));

        const msgwJobName = database.getActiveJobs().data.find((job) => job.STATUS === 'MSGW')?.JOB_NAME || '';

        expect(database.getJobLog(msgwJobName)).toContainEqual(expect.objectContaining({
            MESSAGE_TYPE: 'INQUIRY',
            QUALIFIED_JOB_NAME: msgwJobName
        }));
        expect(database.getJobMessages(msgwJobName)).toContainEqual(expect.objectContaining({
            MESSAGE_QUEUE_NAME: 'QSYSOPR',
            MESSAGE_TYPE: 'INQUIRY'
        }));
        expect(database.getSystemMessages().length).toBeGreaterThan(0);

        const heldQueue = database.getJobQueues({ search: 'QARCHIVE' }).data[0];
        expect(heldQueue).toMatchObject({ JOB_QUEUE_STATUS: 'HELD', WAITING_JOBS: 1 });
        database.setJobQueueStatus('QARCHIVE', 'QGPL', 'RELEASED');
        expect(database.getJobQueues({ search: 'QARCHIVE' }).data[0]?.JOB_QUEUE_STATUS).toBe('RELEASED');
        database.setQueuedJobStatus('731004/QSYSOPR/REPORT01', 'HELD');
        expect(database.getQueuedJobs({ search: 'REPORT01' }).data[0]?.JOB_STATUS).toBe('HELD');

        database.close();
    });
});
