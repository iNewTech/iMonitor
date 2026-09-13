import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createKnowledgeStore } from './knowledge-store';
import type { KnowledgeRecord, KnowledgeSourceRef } from './knowledge-contract';

const temporaryDirectories: string[] = [];
const now = '2026-09-13T10:00:00.000Z';
const sourceRef: KnowledgeSourceRef = { kind: 'incident', id: 'incident-1', locator: 'incident://incident-1' };

function record(overrides: Partial<KnowledgeRecord> = {}): KnowledgeRecord {
    return {
        id: 'record-1', schemaVersion: 1, sourceType: 'incident', title: 'Lock wait evidence',
        content: 'QBATCH/LOCKJOB is waiting on object ORDERHDR.', operational: true,
        customerScope: 'customer-a', systemScope: 'system-a', permissions: ['read'], sourceRef,
        evidenceRefs: [{ id: 'evidence-1', label: 'Job snapshot', sourceRef }], observedAt: now,
        indexedAt: now, contentHash: 'a'.repeat(64), redactionProfile: 'ibmi-default', confidence: 'confirmed',
        status: 'observed', qualifiedJob: 'QBATCH/LOCKJOB', objectNames: ['ORDERHDR'], ...overrides
    };
}

afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

async function newStore() {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'imonitor-knowledge-'));
    temporaryDirectories.push(directory);
    return { directory, store: createKnowledgeStore(() => directory) };
}

describe('knowledge store', () => {
    it('upserts idempotently by content hash and replaces a changed stable ID', async () => {
        const { store } = await newStore();
        const first = await store.upsert(record());
        const duplicate = await store.upsert(record({ id: 'source-retry' }));
        expect(first).toMatchObject({ inserted: true, replaced: false, duplicate: false });
        expect(duplicate).toMatchObject({ inserted: false, replaced: true, duplicate: true });
        expect((await store.getStats()).recordCount).toBe(1);

        const changed = await store.upsert(record({ contentHash: 'b'.repeat(64), content: 'Updated evidence.' }));
        expect(changed).toMatchObject({ inserted: false, replaced: true, duplicate: false });
        expect((await store.get('record-1'))?.content).toBe('Updated evidence.');
    });

    it('persists across a new store instance and supports exact scoped lists', async () => {
        const { directory, store } = await newStore();
        await store.upsert(record());
        await store.upsert(record({ id: 'other-system', contentHash: 'b'.repeat(64), systemScope: 'system-b' }));
        const reopened = createKnowledgeStore(() => directory);
        expect((await reopened.get('record-1'))?.title).toBe('Lock wait evidence');
        expect((await reopened.list({ customerScope: 'customer-a', systemScope: 'system-a' })).map((item) => item.id)).toEqual(['record-1']);
    });

    it('keeps lexical search available while indexing work is pending', async () => {
        const { store } = await newStore();
        await store.upsert(record());
        expect((await store.search({ customerScope: 'customer-a', systemScope: 'system-a', query: 'LOCKJOB ORDERHDR' })).map((item) => item.id)).toEqual(['record-1']);
        expect((await store.getStats()).state).toBe('rebuilding');
        await store.completeReindex(['record-1'], '2026-09-13T10:01:00.000Z');
        expect((await store.getStats()).state).toBe('ready');
    });

    it('retires and deletes record metadata plus derived search entries', async () => {
        const { store } = await newStore();
        await store.upsert(record());
        const retired = await store.retire('record-1', '2026-09-13T11:00:00.000Z', 'operator-a');
        expect(retired.status).toBe('retired');
        expect(await store.search({ customerScope: 'customer-a', systemScope: 'system-a', query: 'LOCKJOB' })).toEqual([]);
        expect(await store.delete('record-1')).toEqual({ deleted: true, recordId: 'record-1' });
        expect(await store.get('record-1')).toBeUndefined();
        expect((await store.getStats()).recordCount).toBe(0);
    });

    it('purges only the selected scope and retention cutoff', async () => {
        const { store } = await newStore();
        await store.upsert(record({ observedAt: '2026-09-01T10:00:00.000Z' }));
        await store.upsert(record({ id: 'new', contentHash: 'b'.repeat(64), observedAt: '2026-09-12T10:00:00.000Z' }));
        await store.upsert(record({ id: 'other-system', contentHash: 'c'.repeat(64), systemScope: 'system-b', observedAt: '2026-09-01T10:00:00.000Z' }));
        const result = await store.purge({ customerScope: 'customer-a', systemScope: 'system-a' }, '2026-09-10T00:00:00.000Z');
        expect(result.deletedIds).toEqual(['record-1']);
        expect((await store.getStats()).recordCount).toBe(2);
        expect(await store.search({ customerScope: 'customer-a', systemScope: 'system-a', query: 'LOCKJOB' })).toHaveLength(1);
    });

    it('marks and rebuilds pending indexes without losing local records', async () => {
        const { store } = await newStore();
        await store.upsert(record());
        await store.completeReindex(['record-1'], '2026-09-13T10:01:00.000Z');
        const rebuilding = await store.markReindex({ customerScope: 'customer-a', systemScope: 'system-a' });
        expect(rebuilding.pendingIndexing).toBe(1);
        const ready = await store.rebuildIndex('2026-09-13T10:02:00.000Z');
        expect(ready.pendingIndexing).toBe(0);
        expect((await store.search({ customerScope: 'customer-a', systemScope: 'system-a', query: 'waiting' }))).toHaveLength(1);
    });

    it('reports a degraded state when the persisted store is corrupt', async () => {
        const { directory, store } = await newStore();
        await store.upsert(record());
        await store.flush();
        await fs.writeFile(path.join(directory, 'imonitor-knowledge', 'knowledge-store.json'), '{broken', 'utf8');
        const reopened = createKnowledgeStore(() => directory);
        const stats = await reopened.getStats();
        expect(stats.state).toBe('degraded');
        expect(stats.recordCount).toBe(0);
        expect(await reopened.search({ customerScope: 'customer-a', systemScope: 'system-a', query: 'LOCKJOB' })).toEqual([]);
        const recovered = await reopened.upsert(record());
        expect(recovered.inserted).toBe(true);
        expect((await reopened.getStats()).state).toBe('rebuilding');
    });
});
