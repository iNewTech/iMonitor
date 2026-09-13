import { beforeEach, describe, expect, it, vi } from 'vitest';

const handlers = vi.hoisted(() => new Map<string, (...args: any[]) => any>());
vi.mock('electron/main', () => ({ ipcMain: { handle: (channel: string, callback: (...args: any[]) => any) => handlers.set(channel, callback) } }));

import { registerKnowledgeIndexIpc } from './knowledge-index-ipc';

beforeEach(() => handlers.clear());

describe('knowledge index IPC', () => {
    it('returns the catalog and never requires a renderer secret for reading settings', async () => {
        registerKnowledgeIndexIpc({
            getSettings: () => ({
                success: true,
                settings: { backend: 'local', endpoint: '', collection: 'imonitor-knowledge', apiKeyConfigured: true },
                catalog: [{ backend: 'local', label: 'Local', description: 'Local', available: true }],
                health: { backend: 'local', state: 'ready', message: 'Ready', checkedAt: '2026-09-13T10:00:00.000Z' }
            }),
            saveSettings: () => ({ success: true }),
            testConnection: async () => ({ backend: 'local', state: 'ready', message: 'Ready', checkedAt: '2026-09-13T10:00:00.000Z' })
        });
        const result = await handlers.get('get-knowledge-index-settings')!();
        expect(result.settings).toEqual(expect.objectContaining({ apiKeyConfigured: true }));
        expect(result.settings).not.toHaveProperty('apiKey');
        expect(result.catalog).toHaveLength(1);
    });

    it('reports disabled or failed connection states without throwing through IPC', async () => {
        registerKnowledgeIndexIpc({
            getSettings: () => ({ success: true }),
            saveSettings: () => ({ success: false, error: 'Provider is unavailable.' }),
            testConnection: async () => ({ backend: 'qdrant', state: 'disabled', message: 'Provider is unavailable.', checkedAt: '2026-09-13T10:00:00.000Z' })
        });
        const result = await handlers.get('test-knowledge-index-connection')!();
        expect(result).toMatchObject({ success: false, error: 'Provider is unavailable.', health: { state: 'disabled' } });
        expect(await handlers.get('save-knowledge-index-settings')!(null, { backend: 'qdrant' })).toMatchObject({ success: false });
    });
});
