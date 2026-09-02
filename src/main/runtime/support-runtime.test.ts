import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSupportRuntime } from './support-runtime';

const temporaryDirectories: string[] = [];

afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) => (
        fs.rm(directory, { recursive: true, force: true })
    )));
});

describe('support-runtime', () => {
    it('writes an encrypted diagnostics payload instead of a readable log file', async () => {
        const downloadsPath = await fs.mkdtemp(path.join(os.tmpdir(), 'imonitor-support-'));
        temporaryDirectories.push(downloadsPath);
        const openExternal = vi.fn(async () => undefined);
        const showItemInFolder = vi.fn();
        const recordActivity = vi.fn();

        const runtime = createSupportRuntime({
            appName: 'iMonitor',
            appVersion: '1.2.3',
            supportEmail: 'support@example.com',
            downloadsPath,
            openExternal,
            showItemInFolder,
            recordActivity,
            encryptDiagnostics: (value) => Buffer.from(value, 'utf8').toString('base64'),
            getDeveloperLogText: () => 'SQL activity\npassword=secret'
        });

        const result = await runtime.sendSupportDiagnostics();
        const encryptedFile = await fs.readFile(result.filePath || '', 'utf8');

        expect(result.success).toBe(true);
        expect(encryptedFile).not.toContain('SQL activity');
        expect(encryptedFile).not.toContain('password=secret');
        expect(openExternal).toHaveBeenCalledWith(expect.stringContaining('mailto:support%40example.com'));
        expect(showItemInFolder).toHaveBeenCalledWith(result.filePath);
        expect(recordActivity).toHaveBeenCalledWith(expect.objectContaining({
            message: 'Prepared support diagnostics and opened a mail draft.'
        }));
    });
});
