import { beforeEach, describe, expect, it, vi } from 'vitest';

const handlers = vi.hoisted(() => new Map<string, (...args: any[]) => any>());
const writeFile = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('electron/main', () => ({ ipcMain: { handle: (channel: string, callback: (...args: any[]) => any) => handlers.set(channel, callback) } }));
vi.mock('node:fs/promises', () => ({ writeFile }));

import { createObservabilityLedger } from '../../features/observability/observability-ledger';
import type { KnowledgeAccessContext } from '../../features/knowledge/knowledge-access';
import { registerObservabilityIpc } from './observability-ipc';

const context = { customerScope: 'customer-a', systemScope: 'system-a', operatorId: 'operator-a', operatorPermissions: ['read', 'investigate'], identity: 'local-owner' as const };
let current: KnowledgeAccessContext = { ...context };
let dependencies: Parameters<typeof registerObservabilityIpc>[0];

beforeEach(() => {
    handlers.clear();
    writeFile.mockReset().mockResolvedValue(undefined);
    current = { ...context };
    const ledger = createObservabilityLedger();
    dependencies = {
        getAccessContext: () => current,
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
        saveSettings: (value) => ({ retentionDays: 30, maxEvents: 10000, ...value }),
        showSaveDialog: async () => ({ canceled: false, filePath: '/test/observability.json' }),
        getDownloadsPath: () => '/test'
    };
    registerObservabilityIpc(dependencies);
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

    it.each(['customerScope', 'systemScope', 'operatorId', 'identity'] as const)('rejects a purge confirmed under another %s before enqueueing', async (key) => {
        const runtime = dependencies.getRuntime();
        const purge = vi.spyOn(runtime, 'purge');
        dependencies.getRuntime = () => runtime;
        const expectedContext = {
            customerScope: context.customerScope, systemScope: context.systemScope,
            operatorId: context.operatorId, identity: context.identity,
            [key]: key === 'identity' ? 'delegated' : 'other'
        };
        const result = await handlers.get('purge-aiab-observability')!(null, { confirmed: true, expectedContext });
        expect(result).toMatchObject({ success: false, error: expect.stringContaining('connection changed') });
        expect(purge).not.toHaveBeenCalled();
    });

    it.each([undefined, null, [], {}, 'invalid', { ...context, operatorId: '' }, { ...context, identity: 'unknown' }])('rejects an explicitly malformed purge context: %j', async (expectedContext) => {
        const runtime = dependencies.getRuntime();
        const purge = vi.spyOn(runtime, 'purge');
        dependencies.getRuntime = () => runtime;
        const result = await handlers.get('purge-aiab-observability')!(null, { confirmed: true, expectedContext });
        expect(result).toMatchObject({ success: false, error: expect.stringContaining('context is missing or invalid') });
        expect(purge).not.toHaveBeenCalled();
    });

    it.each(['permission', 'grant', 'scope'] as const)('rechecks current %s immediately before enqueueing the purge', async (change) => {
        current = { ...context, identity: 'delegated', grant: {
            organizationId: context.customerScope, operatorId: context.operatorId, systemIds: [context.systemScope],
            permissions: ['read', 'investigate'], status: 'active', expiresAt: '2099-01-01T00:00:00.000Z'
        } };
        const expectedContext = { ...current };
        const runtime = dependencies.getRuntime();
        const purge = vi.spyOn(runtime, 'purge');
        dependencies.getRuntime = () => {
            if (change === 'permission') current.operatorPermissions = ['read'];
            else if (change === 'grant') current.grant!.status = 'revoked';
            else current.systemScope = 'system-b';
            return runtime;
        };
        expect(await handlers.get('purge-aiab-observability')!(null, { confirmed: true, expectedContext })).toMatchObject({ success: false });
        expect(purge).not.toHaveBeenCalled();
    });

    it.each([false, true])('keeps authorized standalone and context-bound purges compatible (context: %s)', async (withContext) => {
        const runtime = dependencies.getRuntime();
        const purge = vi.spyOn(runtime, 'purge');
        dependencies.getRuntime = () => runtime;
        const before = '2099-01-01T00:00:00.000Z';
        const payload = { before, confirmed: true, ...(withContext ? { expectedContext: { ...context } } : {}) };
        expect(await handlers.get('purge-aiab-observability')!(null, payload)).toMatchObject({ success: true, deletedCount: 0 });
        expect(purge).toHaveBeenCalledOnce();
        expect(purge).toHaveBeenCalledWith(before);
    });

    it('does not reset the event cap when saving only retention days', async () => {
        dependencies.getSettings = () => ({ retentionDays: 30, maxEvents: 250 });
        const result = await handlers.get('save-aiab-observability-settings')!(null, { retentionDays: 14 });
        expect(result).toMatchObject({ success: true, settings: { retentionDays: 14, maxEvents: 250 } });
    });

    it('returns an actionable error when retention persistence fails', async () => {
        const runtime = dependencies.getRuntime();
        runtime.setSettings = async () => { throw new Error('Disk full'); };
        dependencies.getRuntime = () => runtime;
        expect(await handlers.get('save-aiab-observability-settings')!(null, { retentionDays: 14 })).toEqual({ success: false, error: 'Disk full' });
    });

    it.each(['systemScope', 'operatorId', 'customerScope'] as const)('rejects export when %s changes while the save dialog is open', async (key) => {
        dependencies.showSaveDialog = async () => {
            current[key] = 'other';
            return { canceled: false, filePath: '/test/observability.json' };
        };
        expect(await handlers.get('export-aiab-observability')!()).toMatchObject({ success: false, error: expect.stringContaining('connection changed') });
        expect(writeFile).not.toHaveBeenCalled();
    });

    it('rechecks permissions after reading the export and before writing a file', async () => {
        const runtime = dependencies.getRuntime();
        const report = await runtime.export();
        runtime.export = async () => { current.operatorPermissions = []; return report; };
        dependencies.getRuntime = () => runtime;
        expect(await handlers.get('export-aiab-observability')!()).toMatchObject({ success: false });
        expect(writeFile).not.toHaveBeenCalled();
    });

    it('discards a mixed-scope health response after a connection change', async () => {
        dependencies.getModelStatus = () => {
            current.systemScope = 'another';
            return { enabled: false, provider: 'test', model: '', state: 'disabled', message: 'Off' };
        };
        const result = await handlers.get('get-aiab-observability')!();
        expect(result.success).toBe(false);
        expect(result).not.toHaveProperty('snapshot');
    });

    it('exports the scoped report and treats cancellation as a no-op', async () => {
        expect(await handlers.get('export-aiab-observability')!()).toEqual({ success: true, filePath: '/test/observability.json' });
        expect(JSON.parse(writeFile.mock.calls[0][1])).toMatchObject({ scope: { customerScope: 'customer-a', systemScope: 'system-a' }, events: [] });
        writeFile.mockClear();
        dependencies.showSaveDialog = async () => ({ canceled: true, filePath: '' });
        expect(await handlers.get('export-aiab-observability')!()).toEqual({ success: false, canceled: true });
        expect(writeFile).not.toHaveBeenCalled();
    });
});
