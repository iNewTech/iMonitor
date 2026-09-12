import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createCollectionRuntime } from './collection-runtime';

const contexts = {
    systemId: 'system-a',
    systemLabel: 'System A',
    host: 'ibmi-a',
    user: 'operator',
    mode: 'live' as const
};

const job = { JOB_NAME: '123/USER/JOB', STATUS: 'RUN', CPU: '12.5' } as never;
const temporaryDirectories: string[] = [];

afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('collection runtime', () => {
    it('stores polls per system and reports an inventory', async () => {
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'imonitor-collection-'));
        temporaryDirectories.push(directory);
        const runtime = createCollectionRuntime(() => directory);
        await runtime.appendPoll([job], '2026-09-12T10:00:00.000Z', 5000, contexts);
        await runtime.appendPoll([], '2026-09-12T10:00:05.000Z', 5000, { ...contexts, systemId: 'system-b' });

        const inventory = await runtime.getInventory();
        expect(inventory.recordCount).toBe(2);
        expect(inventory.systems).toEqual({ 'system-a': 1, 'system-b': 1 });
        expect(inventory.byteCount).toBeGreaterThan(0);
    });

    it('previews and confirms a purge while preserving the audit chain', async () => {
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'imonitor-collection-'));
        temporaryDirectories.push(directory);
        const runtime = createCollectionRuntime(() => directory);
        await runtime.appendPoll([job], '2026-09-12T10:00:00.000Z', 5000, contexts);
        const preview = await runtime.previewPurge({ systemId: 'system-a' });
        expect(preview.matchingRecordCount).toBe(1);

        const result = await runtime.purge({ systemId: 'system-a' });
        expect(result.matchingRecordCount).toBe(1);
        expect((await runtime.getInventory()).recordCount).toBe(0);
        expect((await fs.readFile(path.join(directory, 'imonitor-collection', 'purge-audit.jsonl'), 'utf8')).trim()).toContain('"type":"purge"');
    });
});
