import { describe, expect, it } from 'vitest';
import type { KnowledgeCitation, KnowledgeRecord } from './knowledge-contract';
import { buildKnowledgeContextPack } from './knowledge-context-pack';
import type { KnowledgeRetrievalMatch } from './knowledge-retrieval';

const now = '2026-09-13T10:00:00.000Z';

function record(overrides: Partial<KnowledgeRecord> = {}): KnowledgeRecord {
    return {
        id: 'record-1', schemaVersion: 1, sourceType: 'runbook', title: 'Lock wait procedure',
        content: 'Inspect the lock owner and confirm the current job state before taking action.', operational: true,
        customerScope: 'customer-a', systemScope: 'system-a', permissions: ['read'],
        sourceRef: { kind: 'file', id: 'runbook-1', locator: 'local://lock.md' }, evidenceRefs: [],
        observedAt: now, contentHash: 'a'.repeat(64), redactionProfile: 'ibmi-default', confidence: 'high',
        status: 'approved', reviewer: 'operator-a', reviewAt: now, objectNames: [], ...overrides
    };
}

function match(item: KnowledgeRecord, overrides: Partial<KnowledgeRetrievalMatch> = {}): KnowledgeRetrievalMatch {
    const citation: KnowledgeCitation = {
        id: `citation:${item.id}`, recordId: item.id, label: item.title, sourceRef: item.sourceRef,
        status: item.status, observedAt: item.observedAt
    };
    return { record: item, citation, reasons: ['Exact identifier', 'Approved source'], reviewState: 'approved', source: 'lexical', ...overrides };
}

describe('knowledge context packs', () => {
    it('keeps scope, citations, reasons, and records inside a bounded budget', () => {
        const pack = buildKnowledgeContextPack({
            scope: { customerScope: 'customer-a', systemScope: 'system-a', operatorId: 'operator-a', qualifiedJob: 'QBATCH/NIGHT' },
            matches: [
                match(record({ id: 'first', contentHash: 'b'.repeat(64), content: 'x'.repeat(800) })),
                match(record({ id: 'second', contentHash: 'c'.repeat(64) }))
            ],
            maxRecords: 1,
            maxCharacters: 500,
            now
        });

        expect(pack.scope).toMatchObject({ customerScope: 'customer-a', systemScope: 'system-a', qualifiedJob: 'QBATCH/NIGHT' });
        expect(pack.records).toHaveLength(1);
        expect(pack.citations).toHaveLength(1);
        expect(pack.relevanceReasons?.[0]).toMatchObject({ recordId: 'first', source: 'lexical' });
        expect(pack.budget).toMatchObject({ maxCharacters: 500, recordCount: 1 });
        expect(pack.budget?.characters).toBeLessThanOrEqual(500);
        expect(pack.excluded).toContainEqual({ recordId: 'second', reason: 'context-record-limit' });
    });

    it('marks age-expired evidence stale without changing the stored record lifecycle', () => {
        const source = record({ id: 'old-job', sourceType: 'job', observedAt: '2026-09-10T10:00:00.000Z', status: 'approved' });
        const pack = buildKnowledgeContextPack({
            scope: { customerScope: 'customer-a', systemScope: 'system-a' },
            matches: [match(source)],
            freshnessPolicy: { job: 24 * 60 * 60 * 1_000 },
            now
        });

        expect(pack.records[0].status).toBe('approved');
        expect(pack.citations[0].status).toBe('stale');
        expect(pack.freshness).toBe('stale');
    });

    it('makes no-match and caller-provided missing evidence explicit', () => {
        const empty = buildKnowledgeContextPack({
            scope: { customerScope: 'customer-a', systemScope: 'system-a' }, matches: [], now
        });
        expect(empty.records).toEqual([]);
        expect(empty.citations).toEqual([]);
        expect(empty.missingEvidence).toEqual(['No matching support evidence was found.']);

        const partial = buildKnowledgeContextPack({
            scope: { customerScope: 'customer-a', systemScope: 'system-a' }, matches: [],
            missingEvidence: ['Current lock owner was not captured.', 'Current lock owner was not captured.'], now
        });
        expect(partial.missingEvidence).toEqual(['Current lock owner was not captured.']);
    });
});
