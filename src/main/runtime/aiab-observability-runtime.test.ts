import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAiabObservabilityRuntime } from './aiab-observability-runtime';

let userDataPath: string;
const scopeA = { customerScope: 'a', systemScope: 'one', operatorId: 'alice' };
const scopeB = { customerScope: 'b', systemScope: 'two', operatorId: 'bob' };
const settings = { retentionDays: 30, maxEvents: 100 };

beforeEach(async () => { userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'imonitor-observability-')); });
afterEach(async () => {
    vi.useRealTimers();
    await fs.rm(userDataPath, { recursive: true, force: true });
});

describe('AI + ActionBoard observability runtime', () => {
    it('persists redacted scoped events and can purge them', async () => {
        const create = () => createAiabObservabilityRuntime({
            userDataPath,
            getSettings: () => settings,
            getScope: () => ({ customerScope: 'customer-a', systemScope: 'system-a', operatorId: 'operator-a' })
        });
        const first = create();
        first.recordAudit('retrieval', 'search', 'success', { prompt: 'should never persist', returned: 2 });
        await first.flush();
        const second = create();
        expect((await second.getEvents())[0]).toMatchObject({ name: 'retrieval:search', scope: { customerScope: 'customer-a' } });
        expect(JSON.stringify(await second.export())).not.toContain('should never persist');
        expect((await second.purge('2099-01-01T00:00:00.000Z')).deletedCount).toBe(1);
    });

    it('captures scope and attributes before loading or switching profiles', async () => {
        let scope = scopeA;
        const runtime = createAiabObservabilityRuntime({ userDataPath, getSettings: () => settings, getScope: () => scope });
        const attributes = { provider: 'local' };
        runtime.recordMetric('model_latency_ms', 10, attributes);
        const firstRead = runtime.getEvents();
        scope = scopeB;
        attributes.provider = 'changed';
        runtime.recordAudit('retrieval', 'search');
        await runtime.flush();
        expect(await firstRead).toEqual([expect.objectContaining({ scope: scopeA, attributes: { provider: 'local' } })]);
        expect(await runtime.getEvents()).toEqual([expect.objectContaining({ scope: scopeB, name: 'retrieval:search' })]);
    });

    it('serializes purge between records and persists the same result on restart', async () => {
        const create = () => createAiabObservabilityRuntime({ userDataPath, getSettings: () => settings, getScope: () => scopeA });
        const runtime = create();
        runtime.recordAudit('system', 'before-purge');
        const purge = runtime.purge('2099-01-01T00:00:00.000Z');
        runtime.recordAudit('system', 'after-purge');
        expect((await purge).deletedCount).toBe(1);
        await runtime.flush();
        expect((await create().getEvents()).map((event) => event.name)).toEqual(['system:after-purge']);
    });

    it('reports storage failures without rejecting background work and recovers on the next write', async () => {
        const directory = path.join(userDataPath, 'imonitor-observability');
        await fs.writeFile(directory, 'blocks directory creation');
        const runtime = createAiabObservabilityRuntime({ userDataPath, getSettings: () => settings, getScope: () => scopeA });
        runtime.recordAudit('system', 'disk-failure');
        await runtime.flush();
        expect(await runtime.getSnapshot()).toMatchObject({ state: 'degraded', eventCount: 1, degradedReasons: [expect.stringContaining('could not be saved')] });
        await fs.unlink(directory);
        runtime.recordAudit('system', 'retry');
        await runtime.flush();
        expect(await runtime.getSnapshot()).toMatchObject({ state: 'ready', eventCount: 2, degradedReasons: [] });
    });

    it('uses current settings and applies retention when loading persisted events', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-09-01T00:00:00Z'));
        const runtime = createAiabObservabilityRuntime({ userDataPath, getSettings: () => settings, getScope: () => scopeA });
        runtime.recordAudit('system', 'old-event');
        await runtime.flush();
        vi.setSystemTime(new Date('2026-09-14T00:00:00Z'));
        const restarted = createAiabObservabilityRuntime({ userDataPath, getSettings: () => ({ ...settings, retentionDays: 7 }), getScope: () => scopeA });
        expect(await restarted.getSnapshot()).toMatchObject({ eventCount: 0, retentionDays: 7 });
        expect(await restarted.setSettings({ retentionDays: 14 })).toEqual({ ...settings, retentionDays: 14 });
        const saved = JSON.parse(await fs.readFile(path.join(userDataPath, 'imonitor-observability', 'observability.json'), 'utf8'));
        expect(saved.settings.retentionDays).toBe(14);
    });
});
