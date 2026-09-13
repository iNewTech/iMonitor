import { describe, expect, it } from 'vitest';
import type { KnowledgeRecord } from './knowledge-contract';
import { buildKnowledgeRetrievalQuery, rankKnowledgeRecords } from './knowledge-retrieval';

const now = '2026-09-13T10:00:00.000Z';

function record(overrides: Partial<KnowledgeRecord> = {}): KnowledgeRecord {
    return {
        id: 'record-1', schemaVersion: 1, sourceType: 'runbook', title: 'Night batch lock wait',
        content: 'Check the lock owner before releasing QBATCH/NIGHT.', operational: true,
        customerScope: 'customer-a', systemScope: 'system-a', permissions: ['read'],
        sourceRef: { kind: 'file', id: 'runbook-1', locator: 'local://night.md' }, evidenceRefs: [],
        observedAt: now, contentHash: 'a'.repeat(64), redactionProfile: 'ibmi-default', confidence: 'high',
        status: 'approved', qualifiedJob: 'QBATCH/NIGHT', objectNames: ['ORDERHDR'], ...overrides
    };
}

describe('knowledge retrieval', () => {
    it('builds a bounded query with operational fields and operator scope', () => {
        const query = buildKnowledgeRetrievalQuery({
            customerScope: 'customer-a', systemScope: 'system-a', operatorId: 'operator-a', operatorPermissions: ['read', 'investigate'],
            query: 'why is the batch waiting?', qualifiedJob: 'QBATCH/NIGHT', incidentKind: 'lockWait', signal: 'LCKW',
            objectIdentifiers: ['ORDERHDR'], runtimeFingerprint: 'IBM i 7.4 / PTF123', limit: 500
        });
        expect(query.indexRequest).toMatchObject({ customerScope: 'customer-a', systemScope: 'system-a', limit: 100 });
        expect(query.indexRequest.query).toContain('qbatch/night');
        expect(query.indexRequest.query).toContain('orderhdr');
        expect(query.exactIdentifiers).toEqual(expect.arrayContaining(['QBATCH/NIGHT', 'lockWait', 'LCKW', 'ORDERHDR']));
        expect(query.operatorScope).toEqual({ operatorId: 'operator-a', permissions: ['read', 'investigate'] });
    });

    it('ranks exact identifiers ahead of broad symptom matches and returns reasons and citations', () => {
        const query = buildKnowledgeRetrievalQuery({
            customerScope: 'customer-a', systemScope: 'system-a', operatorId: 'operator-a', operatorPermissions: ['read'],
            query: 'lock wait QBATCH/NIGHT', qualifiedJob: 'QBATCH/NIGHT', objectIdentifiers: ['ORDERHDR']
        });
        const result = rankKnowledgeRecords([
            record({ id: 'broad', contentHash: 'b'.repeat(64), title: 'General lock wait guidance', content: 'Inspect the lock owner.' }),
            record({ id: 'exact', title: 'QBATCH/NIGHT lock wait', contentHash: 'c'.repeat(64) })
        ], query, 'lexical', now);
        expect(result.matches.map((match) => match.record.id)).toEqual(['exact', 'broad']);
        expect(result.matches[0].reasons.join(' ')).toContain('Exact identifier');
        expect(result.matches[0].citation.id).toBe('citation:exact');
        expect(result.matches[0].reviewState).toBe('approved');
    });

    it('marks stale and draft sources for review and deduplicates duplicate content', () => {
        const query = buildKnowledgeRetrievalQuery({
            customerScope: 'customer-a', systemScope: 'system-a', operatorId: 'operator-a', operatorPermissions: ['read'], query: 'lock'
        });
        const result = rankKnowledgeRecords([
            record({ id: 'stale', contentHash: 'a'.repeat(64), expiresAt: '2026-09-12T00:00:00.000Z' }),
            record({ id: 'duplicate', contentHash: 'a'.repeat(64) }),
            record({ id: 'draft', contentHash: 'd'.repeat(64), status: 'draft' })
        ], query, 'hybrid', now);
        expect(result.matches.map((match) => match.record.id)).toEqual(['stale', 'draft']);
        expect(result.matches[0].reviewState).toBe('stale');
        expect(result.matches[1].reviewState).toBe('needs-review');
        expect(result.matches.every((match) => match.source === 'hybrid')).toBe(true);
    });

    it('returns an explicit no-match state for empty results', () => {
        const query = buildKnowledgeRetrievalQuery({
            customerScope: 'customer-a', systemScope: 'system-a', operatorId: 'operator-a', operatorPermissions: ['read'], query: 'unknown'
        });
        expect(rankKnowledgeRecords([], query)).toMatchObject({ matches: [], citations: [], noMatchReason: 'no-match' });
    });
});
