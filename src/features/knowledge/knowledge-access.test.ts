import { describe, expect, it, vi } from 'vitest';
import { filterContextPack, filterKnowledgeRecords, runScopedKnowledgeSearch, type KnowledgeAccessContext } from './knowledge-access';
import type { ContextPack, KnowledgeRecord, KnowledgeSourceRef } from './knowledge-contract';

const sourceRef: KnowledgeSourceRef = { kind: 'incident', id: 'incident-1', locator: 'incident://incident-1' };
const now = '2026-09-13T10:00:00.000Z';

function record(overrides: Partial<KnowledgeRecord> = {}): KnowledgeRecord {
    return {
        id: 'record-1', schemaVersion: 1, sourceType: 'incident', title: 'Lock wait evidence',
        content: 'The selected job is waiting on a lock.', operational: true,
        customerScope: 'customer-a', systemScope: 'system-a', permissions: ['read'], sourceRef,
        evidenceRefs: [{ id: 'evidence-1', label: 'Job snapshot', sourceRef }],
        observedAt: now, indexedAt: now, contentHash: 'a'.repeat(64), redactionProfile: 'ibmi-default',
        confidence: 'confirmed', status: 'observed', objectNames: [], ...overrides
    };
}

function ownerContext(overrides: Partial<KnowledgeAccessContext> = {}): KnowledgeAccessContext {
    return {
        customerScope: 'customer-a', systemScope: 'system-a', operatorId: 'owner-a',
        operatorPermissions: ['read', 'investigate'], identity: 'local-owner', now, ...overrides
    };
}

function delegatedContext(overrides: Partial<KnowledgeAccessContext> = {}): KnowledgeAccessContext {
    return ownerContext({
        operatorId: 'support-a', identity: 'delegated',
        grant: {
            organizationId: 'customer-a', operatorId: 'support-a', systemIds: ['system-a'],
            permissions: ['read', 'investigate'], status: 'active', expiresAt: '2026-09-14T10:00:00.000Z'
        }, ...overrides
    });
}

function pack(records: KnowledgeRecord[]): ContextPack {
    return {
        schemaVersion: 1, generatedAt: now, records,
        citations: records.map((item) => ({ id: `citation:${item.id}`, recordId: item.id, label: item.title, sourceRef, status: item.status })),
        excluded: [], freshness: 'current', missingEvidence: []
    };
}

describe('knowledge access policy', () => {
    it('allows the local owner and filters cross-customer and cross-system records', () => {
        const result = filterKnowledgeRecords([
            record(),
            record({ id: 'other-customer', customerScope: 'customer-b' }),
            record({ id: 'other-system', systemScope: 'system-b' })
        ], ownerContext());
        expect(result.records.map((item) => item.id)).toEqual(['record-1']);
        expect(result.excluded).toEqual(expect.arrayContaining([
            { recordId: 'other-customer', reason: 'out-of-scope-customer' },
            { recordId: 'other-system', reason: 'out-of-scope-system' }
        ]));
    });

    it('allows a generic non-operational record only when its customer scope matches', () => {
        const result = filterKnowledgeRecords([
            record({ id: 'generic', operational: false, systemScope: '*', sourceType: 'runbook' }),
            record({ id: 'other-generic', operational: false, systemScope: '*', customerScope: 'customer-b' })
        ], ownerContext());
        expect(result.records.map((item) => item.id)).toEqual(['generic']);
        expect(result.excluded[0]).toEqual({ recordId: 'other-generic', reason: 'out-of-scope-customer' });
    });

    it('requires an accepted, unexpired delegated grant and supports revocation', () => {
        expect(filterKnowledgeRecords([record()], delegatedContext()).records).toHaveLength(1);
        expect(filterKnowledgeRecords([record()], delegatedContext({ grant: { ...delegatedContext().grant!, status: 'expired' } })).decision).toMatchObject({ code: 'expired-access' });
        expect(filterKnowledgeRecords([record()], delegatedContext({ grant: { ...delegatedContext().grant!, status: 'revoked' } })).decision).toMatchObject({ code: 'revoked-access' });
        expect(filterKnowledgeRecords([record()], delegatedContext({ grant: { ...delegatedContext().grant!, expiresAt: now } })).decision).toMatchObject({ code: 'expired-access' });
        expect(filterKnowledgeRecords([record()], delegatedContext({ grant: { ...delegatedContext().grant!, organizationId: 'customer-b' } })).decision).toMatchObject({ code: 'out-of-scope-customer' });
        expect(filterKnowledgeRecords([record()], delegatedContext({ grant: { ...delegatedContext().grant!, systemIds: ['system-b'] } })).decision).toMatchObject({ code: 'out-of-scope-system' });
    });

    it('fails closed for missing scope, identity, and read permission', () => {
        expect(filterKnowledgeRecords([record()], ownerContext({ customerScope: '' })).decision).toMatchObject({ code: 'missing-scope' });
        expect(filterKnowledgeRecords([record()], ownerContext({ operatorId: '' })).decision).toMatchObject({ code: 'missing-identity' });
        expect(filterKnowledgeRecords([record()], ownerContext({ operatorPermissions: [] })).decision).toMatchObject({ code: 'permission-denied' });
        expect(filterKnowledgeRecords([record()], { ...ownerContext(), identity: 'delegated', grant: undefined }).decision).toMatchObject({ code: 'missing-grant' });
        expect(filterKnowledgeRecords([record()], ownerContext({ now: 'not-a-timestamp' })).decision).toMatchObject({ code: 'invalid-context' });
    });

    it('excludes invalid records without returning their title or content', () => {
        const result = filterKnowledgeRecords([{ id: 'bad-1', title: 'private title', content: 'private content' }], ownerContext());
        expect(result.records).toEqual([]);
        expect(result.excluded).toEqual([{ recordId: 'bad-1', reason: 'invalid-record' }]);
        expect(JSON.stringify(result.excluded)).not.toContain('private content');
    });

    it('filters before the adapter and again before the returned context pack', async () => {
        const adapter = vi.fn((visible: KnowledgeRecord[]) => pack([
            ...visible,
            record({ id: 'late-cross-system', systemScope: 'system-b', title: 'secret other system' })
        ]));
        const result = await runScopedKnowledgeSearch([
            record(), record({ id: 'early-cross-customer', customerScope: 'customer-b' })
        ], ownerContext(), adapter);
        expect(adapter).toHaveBeenCalledWith([record()]);
        expect(result.success).toBe(true);
        expect(result.contextPack?.records.map((item) => item.id)).toEqual(['record-1']);
        expect(result.excluded).toEqual(expect.arrayContaining([
            { recordId: 'late-cross-system', reason: 'out-of-scope-system' }
        ]));
    });

    it('does not call the adapter when the IPC boundary has no active scope', async () => {
        const adapter = vi.fn(() => pack([record()]));
        const result = await runScopedKnowledgeSearch([record()], ownerContext({ systemScope: '' }), adapter);
        expect(result.success).toBe(false);
        expect(result.error).toContain('active customer and IBM i system scope');
        expect(adapter).not.toHaveBeenCalled();
        expect(result.audit).toEqual(expect.arrayContaining([
            expect.objectContaining({ event: 'knowledge-read-denied', result: 'denied', reason: 'missing-scope' })
        ]));
    });

    it('sanitizes citations and recomputes freshness in a returned pack', () => {
        const current = record({ status: 'approved', reviewer: 'owner-a', reviewAt: now, expiresAt: '2026-09-14T10:00:00.000Z' });
        const other = record({ id: 'other', systemScope: 'system-b' });
        const sanitized = filterContextPack({
            ...pack([current, other]),
            citations: [
                { id: 'safe', recordId: current.id, label: current.title, sourceRef, status: current.status, excerpt: 'safe excerpt' },
                { id: 'leak', recordId: other.id, label: 'other system', sourceRef, status: other.status, excerpt: 'other content' }
            ],
            freshness: 'mixed'
        }, ownerContext());
        expect(sanitized.records.map((item) => item.id)).toEqual(['record-1']);
        expect(sanitized.citations).toHaveLength(1);
        expect(sanitized.citations[0].status).toBe('approved');
        expect(sanitized.freshness).toBe('current');
    });
});
