import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { KnowledgeRecord } from './knowledge-contract';
import { createKnowledgeStore } from './knowledge-store';
import {
    createKnowledgeIndexGateway,
    createLocalKnowledgeIndexAdapter,
    type ExternalKnowledgeIndexAdapter,
    type ProviderKnowledgeRecord
} from './knowledge-index';

const directories: string[] = [];
const context = {
    customerScope: 'customer-a',
    systemScope: 'system-a',
    operatorId: 'operator-a',
    operatorPermissions: ['read', 'investigate'],
    identity: 'local-owner' as const
};

function record(overrides: Partial<KnowledgeRecord> = {}): KnowledgeRecord {
    return {
        id: 'knowledge-1', schemaVersion: 1, sourceType: 'runbook', title: 'Night batch lock wait',
        content: 'QBATCH/NIGHT is waiting on ORDERHDR. Check CPF0001 and release the lock.', operational: true,
        customerScope: 'customer-a', systemScope: 'system-a', permissions: ['read', 'investigate'],
        sourceRef: { kind: 'file', id: 'runbook-1', locator: 'local://night.md' }, evidenceRefs: [],
        observedAt: '2026-09-13T10:00:00.000Z', indexedAt: '2026-09-13T10:00:00.000Z', contentHash: 'a'.repeat(64),
        redactionProfile: 'ibmi-default', confidence: 'high', status: 'observed',
        qualifiedJob: 'QBATCH/NIGHT', objectNames: ['ORDERHDR'], ...overrides
    };
}

async function newStore() {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'imonitor-index-'));
    directories.push(directory);
    const store = createKnowledgeStore(() => directory);
    return { store, local: createLocalKnowledgeIndexAdapter(store) };
}

function providerHit(candidate: KnowledgeRecord): ProviderKnowledgeRecord {
    return {
        id: candidate.id,
        content: candidate.content,
        metadata: {
            customerScope: candidate.customerScope,
            systemScope: candidate.systemScope,
            sourceType: candidate.sourceType,
            sourceRefId: candidate.sourceRef.id,
            contentHash: candidate.contentHash
        },
        record: candidate
    };
}

function external(overrides: Partial<ExternalKnowledgeIndexAdapter> = {}): ExternalKnowledgeIndexAdapter {
    return {
        backend: 'qdrant',
        health: async () => ({ backend: 'qdrant', state: 'ready', message: 'Qdrant is ready.', checkedAt: new Date().toISOString() }),
        upsert: async () => undefined,
        delete: async () => undefined,
        search: async () => [],
        rebuild: async () => undefined,
        stats: async () => ({ state: 'ready', recordCount: 0, byteCount: 0, oldestObservedAt: null, newestObservedAt: null, pendingIndexing: 0, lastReindexedAt: null }),
        ...overrides
    };
}

afterEach(async () => {
    await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('knowledge index adapters', () => {
    it('uses the local adapter for exact operational identifiers and maintenance', async () => {
        const { store, local } = await newStore();
        const candidate = record();
        await local.upsert([candidate]);
        expect((await local.search({ customerScope: 'customer-a', systemScope: 'system-a', query: 'CPF0001' }))[0]).toMatchObject({ id: candidate.id });
        expect((await local.stats({ customerScope: 'customer-a', systemScope: 'system-a' })).recordCount).toBe(1);
        await local.rebuild({ customerScope: 'customer-a', systemScope: 'system-a' });
        await local.delete([candidate.id]);
        expect((await store.getStats()).recordCount).toBe(0);
    });

    it('passes exact scope filters and redacted records to an external adapter', async () => {
        const { local } = await newStore();
        const sent: ProviderKnowledgeRecord[] = [];
        const provider = external({
            upsert: async (records) => { sent.push(...records); },
            search: async () => []
        });
        const gateway = createKnowledgeIndexGateway({
            local,
            external: provider,
            config: { backend: 'qdrant', endpoint: 'https://qdrant.example', collection: 'ops', apiKeyConfigured: true }
        });
        await gateway.upsert([record({ content: 'password=hidden QBATCH/NIGHT' })]);
        expect(sent[0].metadata).toMatchObject({ customerScope: 'customer-a', systemScope: 'system-a' });
        expect(sent[0].content).not.toContain('hidden');
        let request: unknown;
        await gateway.search({ customerScope: 'customer-a', systemScope: 'system-a', query: 'QBATCH/NIGHT' }, context);
        const filterProvider = external({ search: async (requestValue) => { request = requestValue; return []; } });
        await createKnowledgeIndexGateway({
            local,
            external: filterProvider,
            config: { backend: 'qdrant', endpoint: 'https://qdrant.example', collection: 'ops', apiKeyConfigured: false }
        }).search({ customerScope: 'customer-a', systemScope: 'system-a', query: 'QBATCH/NIGHT', limit: 7 }, context);
        expect(request).toEqual({ customerScope: 'customer-a', systemScope: 'system-a', query: 'QBATCH/NIGHT', limit: 7 });
    });

    it.each([
        ['provider timeout', async () => { throw new Error('timeout'); }],
        ['malformed result', async () => [{}]],
    ])('falls back to local lexical search for %s', async (_label, search) => {
        const { local } = await newStore();
        await local.upsert([record()]);
        const result = await createKnowledgeIndexGateway({
            local,
            external: external({ search }),
            config: { backend: 'qdrant', endpoint: 'https://qdrant.example', collection: 'ops', apiKeyConfigured: false }
        }).search({ customerScope: 'customer-a', systemScope: 'system-a', query: 'QBATCH/NIGHT' }, context);
        expect(result.records.map((item) => item.id)).toEqual(['knowledge-1']);
        expect(result.fallbackUsed).toBe(true);
        expect(result.health.state).toBe('degraded');
    });

    it('rejects cross-scope provider records and uses the local fallback', async () => {
        const { local } = await newStore();
        await local.upsert([record()]);
        const unsafe = record({ customerScope: 'customer-b', systemScope: 'system-b' });
        const result = await createKnowledgeIndexGateway({
            local,
            external: external({ search: async () => [providerHit(unsafe)] }),
            config: { backend: 'qdrant', endpoint: 'https://qdrant.example', collection: 'ops', apiKeyConfigured: false }
        }).search({ customerScope: 'customer-a', systemScope: 'system-a', query: 'QBATCH/NIGHT' }, context);
        expect(result.records.map((item) => item.id)).toEqual(['knowledge-1']);
        expect(result.fallbackUsed).toBe(true);
        expect(result.health.message).toContain('fallback');
    });

    it('keeps local retrieval available when the configured provider is not installed', async () => {
        const { local } = await newStore();
        await local.upsert([record()]);
        const gateway = createKnowledgeIndexGateway({
            local,
            config: { backend: 'pgvector', endpoint: '', collection: 'ops', apiKeyConfigured: false }
        });
        expect((await gateway.health()).state).toBe('disabled');
        expect((await gateway.search({ customerScope: 'customer-a', systemScope: 'system-a', query: 'ORDERHDR' }, context)).fallbackUsed).toBe(true);
    });
});
