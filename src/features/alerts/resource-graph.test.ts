import { describe, expect, it } from 'vitest';
import type { ActiveJobRecord } from '../../services/ibmi';
import { buildResourceGraph } from './resource-graph';

const job = (overrides: Partial<ActiveJobRecord> = {}) => ({
    JOB_NAME: '123/USER/WORK', JOB_NAME_SHORT: 'WORK', JOB_NUMBER: '123', JOB_USER: 'USER',
    SUBSYSTEM: 'QBATCH', SUBSYSTEM_LIBRARY_NAME: 'QSYS', SUBSYSTEM_JOB: 'QBATCH/WORK',
    STATUS: 'LCKW', JOB_QUEUE_NAME: 'QBATCH', JOB_QUEUE_LIBRARY: 'QGPL',
    ...overrides
} as ActiveJobRecord);

describe('resource graph', () => {
    it('records only observed incident, queue, subsystem, and lock-owner links', () => {
        const graph = buildResourceGraph({
            job: job(),
            alert: { id: 'a1', incidentId: 'i1', kind: 'lockWait', title: 'LCKW', message: 'blocked' } as any,
            context: { jobInfo: { BLOCKING_JOB: '456/OWNER/HOLDER' } },
            observedAt: '2026-09-12T10:00:00.000Z', now: '2026-09-12T10:00:01.000Z'
        });

        expect(graph.edges.map((edge) => edge.relationship)).toEqual(['raises', 'uses-queue', 'runs-in', 'blocked-by']);
        expect(graph.edges.every((edge) => edge.confidence === 'observed')).toBe(true);
        expect(graph.notes).toHaveLength(0);
    });

    it('explains a missing lock owner without inventing one', () => {
        const graph = buildResourceGraph({ job: job(), observedAt: '2026-09-12T10:00:00.000Z' });

        expect(graph.nodes.some((node) => node.kind === 'lock-owner')).toBe(false);
        expect(graph.notes.join(' ')).toContain('did not return a lock-owner');
    });

    it('marks stale evidence and remains bounded for cycles or large input limits', () => {
        const graph = buildResourceGraph({
            job: job({ STATUS: 'MSGW' }),
            observedAt: '2026-09-12T08:00:00.000Z',
            now: '2026-09-12T10:00:00.000Z',
            staleAfterMs: 60_000,
            maxNodes: 3
        });

        expect(graph.stale).toBe(true);
        expect(graph.nodes.length).toBeLessThanOrEqual(3);
        expect(graph.edges.length).toBeLessThanOrEqual(graph.nodes.length * graph.nodes.length);
    });
});
