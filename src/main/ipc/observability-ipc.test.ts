import { beforeEach, describe, expect, it, vi } from 'vitest';

const handlers = vi.hoisted(() => new Map<string, (...args: any[]) => any>());
vi.mock('electron/main', () => ({ ipcMain: { handle: (channel: string, callback: (...args: any[]) => any) => handlers.set(channel, callback) } }));

import { createObservabilityLedger } from '../../features/observability/observability-ledger';
import { registerObservabilityIpc } from './observability-ipc';

const context = { customerScope: 'customer-a', systemScope: 'system-a', operatorId: 'operator-a', operatorPermissions: ['read', 'investigate'], identity: 'local-owner' as const };

beforeEach(() => {
    handlers.clear();
    const ledger = createObservabilityLedger();
    registerObservabilityIpc({
        getAccessContext: () => context,
        getRuntime: () => ({
            getSnapshot: async () => ledger.snapshot(context),
            export: async () => ledger.export(context),
            purge: async (before: string) => ledger.purge(before, context),
            setSettings: async () => undefined,
            recordAudit: () => undefined
        } as any),
        getKnowledgeStats: async () => ({ backend: 'local', local: { state: 'ready', recordCount: 2, byteCount: 200, oldestObservedAt: null, newestObservedAt: null, pendingIndexing: 0, lastReindexedAt: null }, health: { backend: 'local', state: 'ready', message: 'Ready', checkedAt: '2026-09-14T00:00:00.000Z' }, fallbackUsed: false }),
        getModelStatus: () => ({ enabled: true, provider: 'Open Models', model: 'gemma3:latest', state: 'ready', message: 'Ready' }),
        getMcpStatus: () => ({ installed: 1, enabled: 1, ready: 1, degraded: 0, reasons: [] }),
        getSettings: () => ({ retentionDays: 30, maxEvents: 10000 }),
        saveSettings: () => ({ retentionDays: 30, maxEvents: 10000 })
    });
});

describe('observability IPC', () => {
    it('returns scoped health without secrets', async () => {
        const result = await handlers.get('get-aiab-observability')!();
        expect(result).toMatchObject({ success: true, knowledge: { local: { recordCount: 2 } }, model: { state: 'ready' }, mcp: { ready: 1 } });
        expect(JSON.stringify(result)).not.toContain('apiKey');
    });

    it('requires explicit confirmation for purge', async () => {
        const result = await handlers.get('purge-aiab-observability')!(null, { before: '2026-09-01T00:00:00.000Z' });
        expect(result).toEqual({ success: false, error: 'Observability purge requires explicit confirmation.' });
    });
});
