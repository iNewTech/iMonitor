import { describe, expect, it } from 'vitest';
import {
    getKnowledgeFreshness,
    transitionKnowledgeStatus,
    validateKnowledgeRecord,
    validateKnowledgeSourceRef,
    validateSupportContext,
    type KnowledgeRecord,
    type KnowledgeSourceRef
} from './knowledge-contract';

const sourceRef: KnowledgeSourceRef = { kind: 'incident', id: 'incident-1', locator: 'incident://incident-1' };

function record(overrides: Partial<KnowledgeRecord> = {}): KnowledgeRecord {
    return {
        id: 'record-1',
        schemaVersion: 1,
        sourceType: 'incident',
        title: 'Lock wait evidence',
        content: 'The selected job is waiting on a lock.',
        operational: true,
        customerScope: 'customer-a',
        systemScope: 'system-a',
        permissions: ['read', 'investigate'],
        sourceRef,
        evidenceRefs: [{ id: 'evidence-1', label: 'Job snapshot', sourceRef }],
        observedAt: '2026-09-13T10:00:00.000Z',
        indexedAt: '2026-09-13T10:01:00.000Z',
        expiresAt: '2026-09-14T10:01:00.000Z',
        contentHash: 'a'.repeat(64),
        redactionProfile: 'ibmi-default',
        confidence: 'confirmed',
        status: 'observed',
        objectNames: [],
        ...overrides
    };
}

describe('knowledge contract', () => {
    it('accepts a scoped record and normalizes optional data', () => {
        const result = validateKnowledgeRecord(record({ permissions: ['read', 'read', ' investigate '] }));
        expect(result.valid).toBe(true);
        expect(result.value?.permissions).toEqual(['read', 'investigate']);
        expect(result.value?.schemaVersion).toBe(1);
    });

    it('rejects missing scope for an operational record', () => {
        const result = validateKnowledgeRecord(record({ customerScope: '', systemScope: '' }));
        expect(result.valid).toBe(false);
        expect(result.errors.join(' ')).toContain('customerScope');
        expect(result.errors.join(' ')).toContain('systemScope');
    });

    it('rejects oversized content, malformed hashes, and invalid source references', () => {
        const result = validateKnowledgeRecord(record({ content: 'x'.repeat(32_001), contentHash: 'bad' }));
        expect(result.valid).toBe(false);
        expect(result.errors).toEqual(expect.arrayContaining([
            'content exceeds 32000 characters.',
            'contentHash must be a SHA-256 hex value.'
        ]));
        expect(validateKnowledgeSourceRef({ kind: 'url', id: 'docs', locator: 'http://unsafe.example' }).valid).toBe(false);
    });

    it('rejects credentials in a source reference or support context', () => {
        expect(validateKnowledgeSourceRef({ kind: 'record', id: 'token-value', locator: 'record://1' }).valid).toBe(false);
        const result = validateSupportContext({
            customerScope: 'customer-a',
            systemScope: 'system-a',
            operatorPermissions: ['read'],
            requestedTask: 'Explain the wait',
            apiToken: 'should-not-be-here'
        });
        expect(result.valid).toBe(false);
        expect(result.errors.join(' ')).toContain('credentials');
    });

    it('validates support context with job and incident scope', () => {
        const result = validateSupportContext({
            customerScope: 'customer-a',
            systemScope: 'system-a',
            selectedJob: { qualifiedName: 'QBATCH/LOCKJOB', subsystem: 'QBATCH' },
            incident: { id: 'incident-1', kind: 'lockWait' },
            operatorPermissions: ['read', 'investigate'],
            requestedTask: 'What should the operator inspect first?'
        });
        expect(result.valid).toBe(true);
        expect(result.value?.selectedJob?.qualifiedName).toBe('QBATCH/LOCKJOB');
    });

    it('requires review metadata for approved, blocked, and retired records', () => {
        expect(validateKnowledgeRecord(record({ status: 'approved' })).valid).toBe(false);
        expect(validateKnowledgeRecord(record({ status: 'blocked' })).valid).toBe(false);
        expect(validateKnowledgeRecord(record({ status: 'retired' })).valid).toBe(false);
    });

    it('allows only explicit lifecycle transitions', () => {
        const approved = transitionKnowledgeStatus(record(), 'approved', '2026-09-13T11:00:00.000Z', 'operator-a');
        expect(approved.status).toBe('approved');
        expect(approved.reviewer).toBe('operator-a');
        expect(() => transitionKnowledgeStatus(approved, 'draft', '2026-09-13T11:01:00.000Z')).toThrow('Cannot transition');
        expect(() => transitionKnowledgeStatus(record(), 'approved', '2026-09-13T11:00:00.000Z')).toThrow('reviewer');
    });

    it('reports expiry as stale without mutating the stored status', () => {
        const item = record({ status: 'approved', reviewer: 'operator-a', reviewAt: '2026-09-13T10:00:00.000Z' });
        expect(getKnowledgeFreshness(item, '2026-09-15T10:02:00.000Z')).toBe('stale');
        expect(item.status).toBe('approved');
    });
});
