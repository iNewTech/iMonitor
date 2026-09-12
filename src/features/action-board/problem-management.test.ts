import { describe, expect, it } from 'vitest';
import {
    addProblemOccurrence,
    buildProblemOccurrence,
    confirmProblem,
    createProblemCandidate,
    findProblemMatches,
    normalizeProblemManagement,
    resolveProblem,
    type ProblemContext,
    type ProblemRecord
} from './problem-management';

const context = (overrides: Partial<ProblemContext> = {}): ProblemContext => ({
    systemId: 'prod',
    systemLabel: 'Production',
    job: { JOB_NAME: 'ORDER/POST', TYPE: 'BATCH', SUBSYSTEM: 'QBATCH' } as any,
    alert: {
        id: 'incident-1', incidentId: 'incident-1', kind: 'lockWait', severity: 'warning',
        timestamp: '2026-09-12T10:00:00Z', lastSeenAt: '2026-09-12T10:00:00Z', occurrence: 1,
        title: 'Lock wait detected', message: 'The job is waiting on a lock.', workflowStatus: 'new',
        notes: [], timeline: [], workflowUpdatedAt: '2026-09-12T10:00:00Z',
        correlation: { fingerprint: 'lock:order-post', groupReason: 'same job', suggested: false, relatedSignals: ['lock wait'], priority: {} as any }
    } as any,
    now: '2026-09-12T10:00:00Z',
    ...overrides
});

describe('problem management', () => {
    it('creates an explainable candidate and matches the same job environment', () => {
        const candidate = createProblemCandidate(context(), 'problem-1');
        const matches = findProblemMatches(context({ alert: { ...context().alert, occurrence: 2 } as any }), { records: [candidate] });
        expect(candidate.status).toBe('candidate');
        expect(matches[0]).toMatchObject({ recordId: 'problem-1', score: 100 });
        expect(matches[0].reasons.join(' ')).toContain('fingerprint matches');
    });

    it('does not group changed environments or unrelated same-message jobs', () => {
        const candidate = createProblemCandidate(context(), 'problem-1');
        const changedEnvironment = context({ job: { JOB_NAME: 'ORDER/POST', TYPE: 'INTERACTIVE', SUBSYSTEM: 'QINTER' } as any });
        const differentJob = context({ job: { JOB_NAME: 'INVOICE/POST', TYPE: 'BATCH', SUBSYSTEM: 'QBATCH' } as any, alert: { ...context().alert, message: 'The job is waiting on a lock.' } as any });
        expect(findProblemMatches(changedEnvironment, { records: [candidate] })).toHaveLength(0);
        expect(findProblemMatches(differentJob, { records: [candidate] })).toHaveLength(0);
    });

    it('deduplicates occurrences and reopens a resolved problem', () => {
        const candidate = createProblemCandidate(context(), 'problem-1');
        const resolved = resolveProblem(confirmProblem(candidate, { rootCause: 'Lock owner leaked', workaround: 'Restart the owner.' }, 'l3', '2026-09-12T11:00:00Z'), 'l3', '2026-09-12T12:00:00Z');
        const repeated = buildProblemOccurrence(context({ alert: { ...context().alert, occurrence: 2, id: 'incident-2', incidentId: 'incident-2', lastSeenAt: '2026-09-13T10:00:00Z' } as any }));
        const reopened = addProblemOccurrence(resolved, repeated, '2026-09-13T10:00:00Z');
        expect(addProblemOccurrence(reopened, repeated, '2026-09-13T11:00:00Z').occurrences).toHaveLength(2);
        expect(reopened).toMatchObject({ status: 'reopened', rootCause: 'Lock owner leaked', resolvedAt: undefined });
    });

    it('normalizes bounded records and rejects malformed entries', () => {
        const record = createProblemCandidate(context(), 'problem-1');
        const store = normalizeProblemManagement({ records: [record, { id: 'bad' } as any] });
        expect(store.records).toHaveLength(1);
        expect(normalizeProblemManagement({ records: Array.from({ length: 260 }, (_, index) => ({ ...record, id: `problem-${index}` })) }).records).toHaveLength(250);
    });

    it('stores the confirmed root cause and linked ticket for L3 review', () => {
        const candidate: ProblemRecord = createProblemCandidate(context(), 'problem-1');
        const confirmed = confirmProblem(candidate, { rootCause: 'Stale lock owner', workaround: 'Release the owner after validation.', linkedTicket: { provider: 'jira', key: 'OPS-42' } }, 'l3-specialist', '2026-09-12T13:00:00Z');
        expect(confirmed).toMatchObject({ status: 'confirmed', confirmedBy: 'l3-specialist', linkedTicket: { provider: 'jira', key: 'OPS-42' } });
    });
});
