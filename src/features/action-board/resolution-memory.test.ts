import { describe, expect, it } from 'vitest';
import { approveResolution, exportScopedResolutionMemory, findApplicableResolutions, normalizeResolutionMemory, retireResolution, type ResolutionMemoryEntry } from './resolution-memory';

const entry = (overrides = {}) => ({
    id: 'resolution-1', procedureKey: 'prod:messageWait:ORDER/POST', version: 1, status: 'draft', systemId: 'prod', incidentKind: 'messageWait', jobPattern: 'ORDER/*', title: 'Reply to order message', symptoms: ['Waiting'], evidenceRefs: ['messages @ now'], failedAttempts: ['Retry denied'], successfulAction: 'Reply approved message', verifiedOutcome: 'Monitoring cleared the wait.', environment: { systemLabel: 'Production' }, createdAt: '2026-09-12T10:00:00Z', ...overrides
} as ResolutionMemoryEntry);

describe('resolution memory', () => {
    it('moves a draft through approval and retirement without changing history', () => {
        const draft = entry();
        const approved = approveResolution(draft, 'reviewer', '2026-09-12T11:00:00Z');
        expect(approved).toMatchObject({ status: 'approved', reviewer: 'reviewer', version: 1, reviewDueAt: '2026-12-11T11:00:00.000Z' });
        expect(retireResolution(approved, '2026-09-13T11:00:00Z')).toMatchObject({ status: 'retired', approvedAt: '2026-09-12T11:00:00Z' });
    });

    it('retrieves only approved procedures for the customer and matching incident', () => {
        const store = normalizeResolutionMemory({ entries: [entry({ status: 'approved' }), entry({ id: 'v2', version: 2, status: 'approved', successfulAction: 'New approved action' }), entry({ id: 'wrong', status: 'approved', systemId: 'uat' }), entry({ id: 'retired', status: 'retired' })] });
        const matches = findApplicableResolutions({ systemId: 'prod', job: { JOB_NAME: 'ORDER/POST', SUBSYSTEM_JOB: 'POST' } as any, alert: { kind: 'messageWait' } as any }, store);
        expect(matches.map((item) => item.id)).toEqual(['v2']);
        const retiredLatest = normalizeResolutionMemory({ entries: [entry({ status: 'approved' }), entry({ id: 'v2', version: 2, status: 'retired' })] });
        expect(findApplicableResolutions({ systemId: 'prod', job: { JOB_NAME: 'ORDER/POST', SUBSYSTEM_JOB: 'POST' } as any, alert: { kind: 'messageWait' } as any }, retiredLatest)).toHaveLength(0);
    });

    it('exports only the requested customer scope and bounds malformed data', () => {
        const store = normalizeResolutionMemory({ entries: [entry(), entry({ id: 'global', systemId: '*' }), { id: '', title: '' } as any] });
        expect(exportScopedResolutionMemory(store, 'prod').entries.map((item) => item.id)).toEqual(['resolution-1', 'global']);
        expect(normalizeResolutionMemory({ entries: Array.from({ length: 520 }, (_, index) => entry({ id: String(index) })) }).entries).toHaveLength(500);
    });
});
