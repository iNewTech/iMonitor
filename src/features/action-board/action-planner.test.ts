import { describe, expect, it } from 'vitest';
import type { ActiveJobRecord } from '../../services/ibmi';
import { getRunbookPolicy } from './runbook-policy';
import { buildActionPlannerSnapshot } from './action-planner';

const job = (overrides: Partial<ActiveJobRecord> = {}) => ({
    JOB_NAME: '123/APP/ORDERJOB',
    SUBSYSTEM_JOB: 'QBATCH/ORDERJOB',
    STATUS: 'LCKW',
    DATABASE_LOCK_WAITS: 1,
    ...overrides
} as ActiveJobRecord);

const actions = (overrides: Partial<Record<'inspectLocks' | 'holdJob', { enabled: boolean; reason?: string }>> = {}) => [
    { kind: 'inspectLocks' as const, label: 'Inspect Locks', enabled: overrides.inspectLocks?.enabled ?? true, reason: overrides.inspectLocks?.reason },
    { kind: 'holdJob' as const, label: 'Hold Job', enabled: overrides.holdJob?.enabled ?? true, reason: overrides.holdJob?.reason }
];

describe('action planner', () => {
    it('makes claim the primary step for an unassigned incident', () => {
        const result = buildActionPlannerSnapshot({
            job: job(), operatorActions: actions(),
            incident: { id: 'incident-1', title: 'Lock wait', status: 'new', owner: '' },
            runbook: getRunbookPolicy('lockWait')
        });

        expect(result.primary).toMatchObject({ kind: 'claim', label: 'Claim work' });
    });

    it('merges a runbook with the live operator proposal', () => {
        const result = buildActionPlannerSnapshot({
            job: job(), operatorActions: actions(), runbook: getRunbookPolicy('lockWait')
        });
        const proposal = result.proposals.find((item) => item.actionKind === 'inspectLocks');

        expect(proposal).toMatchObject({
            state: 'ready', effect: 'Inspect the current lock-owner and waiting-job evidence.',
            verificationRule: 'Confirm the lock wait clears and the affected job resumes expected work.'
        });
        expect(proposal?.sources).toEqual(['operator', 'runbook']);
        expect(proposal?.citations).toContain('runbook:runbook-lock-wait-v1:v1');
    });

    it('keeps approved resolution memory advisory and cited', () => {
        const result = buildActionPlannerSnapshot({
            job: job(), operatorActions: actions({ inspectLocks: { enabled: false, reason: 'Refresh required.' }, holdJob: { enabled: false, reason: 'Refresh required.' } }),
            ragResolutions: [{
                id: 'memory-1', procedureKey: 'system:lockWait:ORDERJOB', version: 2, status: 'approved', systemId: 'system',
                incidentKind: 'lockWait', jobPattern: '123/APP/*', title: 'Inspect the owner', symptoms: ['Lock wait'],
                evidenceRefs: ['job:123/APP/ORDERJOB'], failedAttempts: [], successfulAction: 'Inspect lock owner',
                verifiedOutcome: 'The lock wait cleared.', environment: {}, createdAt: '2026-09-13T10:00:00.000Z'
            }]
        });
        const proposal = result.proposals.find((item) => item.id === 'rag:memory-1:v2');

        expect(proposal?.state).toBe('advisory');
        expect(proposal?.citations).toEqual(['runbook:memory-1:v2']);
        expect(result.primary?.kind).toBe('review');
    });

    it('blocks unavailable MCP proposals without turning them into executable actions', () => {
        const result = buildActionPlannerSnapshot({
            job: job(), operatorActions: [],
            mcpActions: [{
                capabilityId: 'job-control', capabilityName: 'Job control', skillVersion: '1.0.0', tool: 'hold-job',
                label: 'Hold job', jobName: '123/APP/ORDERJOB', effect: 'Hold the selected job.', riskClass: 'medium',
                requiredPermissions: ['execute'], evidenceRequirements: ['current job'], verificationRule: 'Next poll shows held.',
                available: false, reason: 'Skill is disabled.'
            }]
        });
        const proposal = result.proposals[0];

        expect(proposal).toMatchObject({ state: 'blocked', reason: 'Skill is disabled.', sources: ['mcp'] });
        expect(result.escalationReasons).toContain('Hold job: Skill is disabled.');
    });
});
