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

        database.close();
    });
});
