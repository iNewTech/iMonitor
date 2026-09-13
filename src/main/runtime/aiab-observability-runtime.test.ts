import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAiabObservabilityRuntime } from './aiab-observability-runtime';

describe('AI + ActionBoard observability runtime', () => {
    it('persists redacted scoped events and can purge them', async () => {
        const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'imonitor-observability-'));
        const settings = { retentionDays: 30, maxEvents: 100 };
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
        await fs.rm(userDataPath, { recursive: true, force: true });
    });
});
