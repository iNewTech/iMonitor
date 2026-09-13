import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const handlers = vi.hoisted(() => new Map<string, (...args: any[]) => any>());
vi.mock('electron/main', () => ({ ipcMain: { handle: (channel: string, callback: (...args: any[]) => any) => handlers.set(channel, callback) } }));

import { createKnowledgeStore } from '../../features/knowledge/knowledge-store';
import { registerKnowledgeIpc } from './knowledge-ipc';

const context = {
    customerScope: 'customer-a',
    systemScope: 'system-a',
    operatorId: 'operator-a',
    operatorPermissions: ['read', 'investigate'],
    identity: 'local-owner' as const
};

let dataPath = '';
let activity: Array<Record<string, unknown>> = [];

beforeEach(async () => {
    handlers.clear();
    dataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'imonitor-knowledge-ipc-'));
    activity = [];
    registerKnowledgeIpc({
        getStore: () => createKnowledgeStore(() => dataPath),
        getAccessContext: () => context,
        recordActivity: (entry) => activity.push(entry)
    });
});

describe('knowledge IPC', () => {
    it('requires a scoped read before touching the store', async () => {
        registerKnowledgeIpc({
            getStore: () => { throw new Error('store should not be opened'); },
            getAccessContext: () => ({ ...context, customerScope: '', systemScope: '' }),
            recordActivity: () => undefined
        });
        const response = await handlers.get('get-knowledge-stats')!();
        expect(response.success).toBe(false);
        expect(response.error).toContain('scope');
    });

    it('saves redacted sources, searches them, opens history, and deletes all source chunks', async () => {
        const add = await handlers.get('add-knowledge-source')!(null, {
            sourceName: 'Night batch runbook',
            sourceType: 'runbook',
            fileName: 'night.md',
            content: 'Job: QBATCH/NIGHT\nStep: inspect\npassword=secret-value\nCheck MSGW before release.'
        });
        expect(add.success).toBe(true);

        const library = await handlers.get('get-knowledge-library')!();
        expect(library.success).toBe(true);
        expect(library.records).toHaveLength(2);
        expect(library.records[0].content).not.toContain('secret-value');

        const search = await handlers.get('search-knowledge')!(null, 'night batch');
        expect(search.records).toHaveLength(2);

        const detail = await handlers.get('get-knowledge-record')!(null, library.records[0].id);
        expect(detail.success).toBe(true);
        expect(detail.history).toHaveLength(2);

        const duplicate = await handlers.get('add-knowledge-source')!(null, {
            sourceName: 'Night batch runbook', sourceType: 'runbook', fileName: 'night.md',
            content: 'Job: QBATCH/NIGHT\nStep: inspect\npassword=secret-value\nCheck MSGW before release.'
        });
        expect(duplicate.success).toBe(true);
        expect((await handlers.get('get-knowledge-library')!()).records).toHaveLength(2);

        const removed = await handlers.get('delete-knowledge-record')!(null, library.records[0].id);
        expect(removed).toMatchObject({ success: true, deletedCount: 2 });
        expect((await handlers.get('get-knowledge-library')!()).records).toHaveLength(0);
        expect(activity.map((entry) => entry.message)).toContain('Knowledge source saved.');
    });

    it('rejects unsupported or oversized uploads before persistence', async () => {
        const unsupported = await handlers.get('add-knowledge-source')!(null, {
            sourceName: 'Unsupported', fileName: 'guide.pdf', content: 'text'
        });
        expect(unsupported.success).toBe(false);
        const oversized = await handlers.get('add-knowledge-source')!(null, {
            sourceName: 'Too large', fileName: 'guide.md', content: 'x'.repeat(200001)
        });
        expect(oversized.success).toBe(false);
        expect((await handlers.get('get-knowledge-library')!()).records).toHaveLength(0);
    });
});
