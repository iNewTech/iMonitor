import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    adaptApprovedResolution,
    adaptCustomerDocument,
    adaptIncidentEvidence,
    adaptJobContext,
    adaptObjectAnalysis,
    adaptRunbook,
    chunkKnowledgeText,
    createKnowledgeRecords,
    ingestKnowledgeSource,
    ingestKnowledgeSources,
    isSupportedDocument,
    redactSensitiveText,
    KnowledgeIngestionCancelledError
} from './knowledge-ingestion';
import { createKnowledgeStore } from './knowledge-store';
import type { KnowledgeSourceRef } from './knowledge-contract';

const sourceRef: KnowledgeSourceRef = { kind: 'record', id: 'source-1', locator: 'incident://source-1' };
const temporaryDirectories: string[] = [];

function input(overrides: Record<string, unknown> = {}) {
    return {
        adapter: 'incident-evidence' as const, sourceId: 'source-1', sourceName: 'Incident source', sourceLocator: sourceRef.locator,
        content: 'Job: QBATCH/LOCKJOB\nMessage: CPF0001\nEvidence: waiting on ORDERHDR', customerScope: 'customer-a', systemScope: 'system-a', ...overrides
    };
}

afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

async function newStore() {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'imonitor-ingestion-'));
    temporaryDirectories.push(directory);
    return createKnowledgeStore(() => directory);
}

describe('knowledge ingestion', () => {
    it('redacts secrets, connection strings, and bearer values before storage', () => {
        const value = redactSensitiveText('password=secret123 jdbc:db2://user:pass@host Bearer abc.def.ghi');
        expect(value).not.toContain('secret123');
        expect(value).not.toContain('jdbc:db2://');
        expect(value).not.toContain('abc.def.ghi');
        expect(value).toContain('[REDACTED]');
    });

    it('keeps message, job, evidence, runbook, and timeline units together', () => {
        const chunks = chunkKnowledgeText('Job: A\njob detail\n\nMessage: CPF123\nmessage detail\n\nTimeline: detected\ntimeline detail\n\nRunbook step: inspect\nstep detail');
        expect(chunks.map((chunk) => chunk.unit)).toEqual(['job', 'message', 'timeline', 'runbook-step']);
        expect(chunks[0].content).toContain('job detail');
        expect(chunks[1].content).toContain('message detail');
    });

    it('bounds oversized source input and chunks', () => {
        const result = createKnowledgeRecords(input({ content: Array.from({ length: 250 }, (_, index) => `Evidence ${index} ${'x'.repeat(100)}`).join('\n') }));
        expect(result.records.length).toBeLessThanOrEqual(100);
        expect(Math.max(...result.records.map((record) => record.content.length))).toBeLessThanOrEqual(4_000);
    });

    it('supports the six initial source adapters with explicit source types', () => {
        expect(adaptIncidentEvidence(input()).records[0].sourceType).toBe('evidence');
        expect(adaptRunbook(input()).records[0].sourceType).toBe('runbook');
        expect(adaptApprovedResolution(input()).records[0].status).toBe('approved');
        expect(adaptJobContext(input()).records[0].sourceType).toBe('job');
        expect(adaptObjectAnalysis(input()).records[0].sourceType).toBe('object-analysis');
        expect(adaptCustomerDocument(input({ sourceName: 'guide.md' })).records[0].operational).toBe(false);
    });

    it('ingests incrementally and retires changed source chunks', async () => {
        const store = await newStore();
        const first = await ingestKnowledgeSource(store, input());
        const duplicate = await ingestKnowledgeSource(store, input());
        expect(first.retiredRecordIds).toEqual([]);
        expect(duplicate.retiredRecordIds).toEqual([]);
        expect((await store.list({ customerScope: 'customer-a', systemScope: 'system-a' }))).toHaveLength(3);

        const changed = await ingestKnowledgeSource(store, input({ content: 'Job: QBATCH/LOCKJOB\nMessage: CPF9999\nEvidence: new message' }));
        expect(changed.retiredRecordIds.length).toBeGreaterThan(0);
        const changedRecords = await store.list({ customerScope: 'customer-a', systemScope: 'system-a' });
        expect(changedRecords.filter((record) => record.status !== 'retired')).toHaveLength(3);
        expect(changedRecords.filter((record) => record.status === 'retired')).toHaveLength(2);
    });

    it('continues independent sources after a partial failure and supports cancellation', async () => {
        const store = await newStore();
        const progress = vi.fn();
        const batch = await ingestKnowledgeSources(store, [
            input(),
            input({ sourceId: 'bad', sourceName: 'bad.pdf', adapter: 'customer-document' }),
            input({ sourceId: 'source-2', sourceName: 'second', content: 'Job: SECOND\nEvidence: okay' })
        ], progress);
        expect(batch.results.map((result) => result.sourceId)).toEqual(['source-1', 'source-2']);
        expect(batch.failures[0].sourceId).toBe('bad');
        expect(progress).toHaveBeenCalledTimes(3);

        const controller = new AbortController();
        controller.abort();
        await expect(ingestKnowledgeSource(store, input({ sourceId: 'cancelled', abortSignal: controller.signal }))).rejects.toBeInstanceOf(KnowledgeIngestionCancelledError);
    });

    it('accepts supported text documents and rejects binary document extensions', () => {
        expect(isSupportedDocument('runbook.md')).toBe(true);
        expect(isSupportedDocument('source.rpgle')).toBe(true);
        expect(isSupportedDocument('manual.pdf')).toBe(false);
    });
});
