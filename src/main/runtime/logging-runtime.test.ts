import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActiveJobRecord } from '../../services/ibmi';
import { createLoggingRuntime } from './logging-runtime';

const temporaryDirectories: string[] = [];

afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) => (
        fs.rm(directory, { recursive: true, force: true })
    )));
});

describe('logging-runtime', () => {
    it('persists developer records through the local encryption function', async () => {
        const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'imonitor-logs-'));
        temporaryDirectories.push(userDataPath);
        const runtime = createLoggingRuntime({
            userDataPath,
            getConnectionContext: () => ({ name: 'Demo', host: 'dummy', user: 'QUSER', port: 8076 }),
            getMonitorMode: () => 'dummy',
            getMonitoringHistory: () => [],
            getActiveAlertsCount: () => 0,
            encryptAtRest: vi.fn((value: string) => `ENCRYPTED:${Buffer.from(value, 'utf8').toString('base64')}`),
            getJobKey: (job: ActiveJobRecord) => String(job.SUBSYSTEM_JOB || ''),
            toNumber: (value: unknown) => Number(value) || 0,
            maxActivityEntries: 10
        });

        const timestamp = new Date().toISOString();
        runtime.persistPoll([{
            SUBSYSTEM_JOB: '123/QUSER/DEMOJOB',
            STATUS: 'MSGW',
            CPU: '12.5',
            FUNCTION_NAME: 'DEMO_FUNCTION'
        } as ActiveJobRecord], timestamp, 5000);

        const jobLogPath = await runtime.getJobReadableLogFilePath('123/QUSER/DEMOJOB');
        const encryptedDailyLog = await fs.readFile(
            path.join(userDataPath, 'logs', `ibm-eye-${timestamp.slice(0, 10)}.log.enc`),
            'utf8'
        );
        const jobLog = await fs.readFile(jobLogPath, 'utf8');

        expect(encryptedDailyLog).toMatch(/^ENCRYPTED:/);
        expect(encryptedDailyLog).not.toContain('DEMO_FUNCTION');
        expect(jobLog).toContain('DEMO_FUNCTION');
    });
});
