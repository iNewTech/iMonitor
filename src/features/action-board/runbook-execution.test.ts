import { describe, expect, it } from 'vitest';
import type { ActiveJobRecord } from '../../services/ibmi';
import { getRunbookPolicy } from './runbook-policy';
import {
    buildCommonRunbookDefinition,
    buildJobRecoveryVerification,
    completeRunbookStep,
    createRunbookExecution,
    getCurrentRunbookStep,
    normalizeRunbookExecutions,
    startRunbookExecution
} from './runbook-execution';

const job = (overrides: Partial<ActiveJobRecord> = {}) => ({
    JOB_NAME: '123/USER/MSGWJOB', STATUS: 'MSGW', CPU: 12, DATABASE_LOCK_WAITS: 0, ...overrides
} as ActiveJobRecord);

function definition() {
    return buildCommonRunbookDefinition({
        policy: getRunbookPolicy('messageWait')!, systemId: 'prod', jobName: '123/USER/MSGWJOB', incidentKey: 'prod::msgw'
    });
}

describe('runbook execution', () => {
    it('builds an ordered, versioned message-wait procedure', () => {
        const result = definition();
        expect(result).toMatchObject({ schema: 'imonitor-runbook', version: 1, scenario: 'messageWait', requiredPermission: 'job-action' });
        expect(result.steps.map((step) => step.kind)).toEqual(['check', 'action', 'verify']);
        expect(result.steps[1].action).toBe('replyMessage');
    });

    it('advances only after a checkpoint reports a successful outcome', () => {
        const runbook = definition();
        const ready = createRunbookExecution(runbook, 'operator', '2026-09-12T10:00:00Z', 'execution-1');
        const running = startRunbookExecution(ready, 'operator', '2026-09-12T10:01:00Z');
        const current = getCurrentRunbookStep(runbook, running);
        expect(current?.id).toBe('confirm-message');
        const updated = completeRunbookStep({ definition: runbook, execution: running, operator: 'operator', output: 'MSGW confirmed.', now: '2026-09-12T10:02:00Z' });
        expect(updated).toMatchObject({ status: 'running', currentStepIndex: 1 });
        expect(updated.steps[0]).toMatchObject({ stepId: 'confirm-message', status: 'succeeded', operator: 'operator' });
    });

    it('pauses after verification finds the issue still active', () => {
        const runbook = definition();
        const execution = startRunbookExecution(createRunbookExecution(runbook, 'operator', '2026-09-12T10:00:00Z'), 'operator', '2026-09-12T10:01:00Z');
        const atVerify = { ...execution, currentStepIndex: 2, status: 'running' as const };
        const updated = completeRunbookStep({
            definition: runbook, execution: atVerify, operator: 'operator', output: 'Still waiting.',
            outcome: { status: 'still-blocked', summary: 'Still waiting.', observedAt: '2026-09-12T10:02:00Z', evidence: ['Job status: MSGW'] },
            now: '2026-09-12T10:02:00Z'
        });
        expect(updated).toMatchObject({ status: 'paused', outcome: { status: 'still-blocked' } });
    });

    it('treats ended or blocked jobs as unrecovered', () => {
        expect(buildJobRecoveryVerification(job({ STATUS: 'MSGW' })).status).toBe('still-blocked');
        expect(buildJobRecoveryVerification(job({ STATUS: 'END' })).status).toBe('failed');
        expect(buildJobRecoveryVerification(job({ STATUS: 'RUN' })).status).toBe('recovered');
    });

    it('bounds malformed persisted executions without accepting invalid records', () => {
        const result = normalizeRunbookExecutions({ executions: [null as any, { schema: 'wrong' } as any, createRunbookExecution(definition(), 'operator', '2026-09-12T10:00:00Z')] });
        expect(result.executions).toHaveLength(1);
        expect(result.executions[0].schema).toBe('imonitor-runbook-execution');
    });
});
