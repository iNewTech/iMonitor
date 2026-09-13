import { describe, expect, it, vi } from 'vitest';
import type { ActiveJobRecord } from '../../services/ibmi';
import type { KnowledgeAccessContext } from '../knowledge/knowledge-access';
import type { KnowledgeRecord } from '../knowledge/knowledge-contract';
import type { KnowledgeIndexHealth } from '../knowledge/knowledge-index';
import { retrieveJobKnowledgeContext } from './job-knowledge';

const now = '2026-09-13T10:00:00.000Z';
const access: KnowledgeAccessContext = {
    customerScope: 'customer-a', systemScope: 'system-a', operatorId: 'operator-a',
    operatorPermissions: ['read', 'investigate'], identity: 'local-owner', now
};
const job = {
    JOB_NAME: '123/APP/ORDERJOB', SUBSYSTEM_JOB: 'QBATCH/ORDERJOB', CURRENT_USER: 'APP',
    SUBSYSTEM: 'QBATCH', FUNCTION_NAME: 'Post orders', STATUS: 'LCKW', CPU: 12,
    SQL_STATEMENT_TEXT: 'select order_id from orders'
} as ActiveJobRecord;

function health(overrides: Partial<KnowledgeIndexHealth> = {}): KnowledgeIndexHealth {
    return { backend: 'local', state: 'ready', message: 'Local lexical retrieval is ready.', checkedAt: now, ...overrides };
}

function record(overrides: Partial<KnowledgeRecord> = {}): KnowledgeRecord {
    return {
        id: 'runbook-1', schemaVersion: 1, sourceType: 'runbook', title: 'Order lock runbook',
        content: 'Inspect the lock owner for 123/APP/ORDERJOB before taking action.', operational: true,
        customerScope: 'customer-a', systemScope: 'system-a', permissions: ['read'],
        sourceRef: { kind: 'file', id: 'lock.md', locator: 'local://lock.md' }, evidenceRefs: [],
        observedAt: now, contentHash: 'a'.repeat(64), redactionProfile: 'ibmi-default', confidence: 'high',
        status: 'approved', reviewer: 'operator-a', reviewAt: now, qualifiedJob: job.JOB_NAME || undefined, objectNames: [], ...overrides
    };
}

describe('selected-job knowledge context', () => {
    it('builds an exact job support context and filters returned records by scope', async () => {
        let request: unknown;
        let searchContext: unknown;
        const index = {
            search: vi.fn(async (value: unknown, context: unknown) => {
                request = value;
                searchContext = context;
                return { records: [record(), record({ id: 'other', systemScope: 'system-b', contentHash: 'b'.repeat(64) })], excluded: [], health: health(), fallbackUsed: false };
            }),
            health: vi.fn(async () => health())
        };
        const result = await retrieveJobKnowledgeContext({
            job,
            alert: {
                id: 'alert-1', kind: 'lockWait', severity: 'warning', timestamp: now, title: 'LCKW detected',
                message: 'The selected job is waiting on a database lock.', jobName: job.JOB_NAME || undefined,
                workflowStatus: 'new', notes: [], timeline: [], workflowUpdatedAt: now
            },
            access,
            index,
            now
        });

        expect(request).toMatchObject({ customerScope: 'customer-a', systemScope: 'system-a' });
        expect(String((request as { query: string }).query)).toContain('123/app/orderjob');
        expect(searchContext).toBe(access);
        expect(result.supportContext.selectedJob?.qualifiedName).toBe(job.JOB_NAME);
        expect(result.supportContext.incident).toMatchObject({ id: 'alert-1', kind: 'lockWait' });
        expect(result.contextPack.records.map((item) => item.id)).toEqual(['runbook-1']);
        expect(result.contextPack.citations[0]).toMatchObject({ id: 'citation:runbook-1', sourceType: 'runbook' });
        expect(result.contextPack.relevanceReasons?.[0].recordId).toBe('runbook-1');
    });

    it('keeps stale knowledge visible with a stale citation and a healthy retrieval state', async () => {
        const index = {
            search: async () => ({ records: [record({ sourceType: 'job', observedAt: '2026-09-10T10:00:00.000Z' })], excluded: [], health: health(), fallbackUsed: false }),
            health: async () => health()
        };
        const result = await retrieveJobKnowledgeContext({ job, access, index, now });
        expect(result.contextPack.citations[0].status).toBe('stale');
        expect(result.contextPack.freshness).toBe('stale');
        expect(result.retrievalHealth.state).toBe('ready');
    });

    it('fails safely and makes the retrieval gap visible when the index is unavailable', async () => {
        const index = {
            search: async () => { throw new Error('provider timeout'); },
            health: async () => health({ state: 'unavailable', message: 'Knowledge retrieval is unavailable.' })
        };
        const result = await retrieveJobKnowledgeContext({ job, access, index, now });
        expect(result.contextPack.records).toEqual([]);
        expect(result.contextPack.missingEvidence[0]).toContain('retrieval failed safely');
        expect(result.retrievalHealth.state).toBe('unavailable');
    });
});
