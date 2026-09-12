import type { ActiveJobRecord } from '../../services/ibmi';
import type { AlertKind } from '../alerts/alert-model';
import type { RecoveryVerificationResult } from './recovery-verification';
import type { OperatorActionKind } from './operator-actions';
import type { RunbookPolicy } from './runbook-policy';

export type RunbookStepKind = 'check' | 'action' | 'verify';
export type RunbookExecutionStatus = 'ready' | 'running' | 'paused' | 'succeeded' | 'failed' | 'escalated';
export type RunbookStepStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped';

export interface RunbookStepDefinition {
    id: string;
    title: string;
    kind: RunbookStepKind;
    requiredEvidence: string[];
    action?: OperatorActionKind;
    confirmationRequired: boolean;
    expectedOutcome: string;
    stopCondition: string;
}

export interface RunbookDefinition {
    schema: 'imonitor-runbook';
    version: 1;
    id: string;
    policyId: string;
    scenario: RunbookPolicy['scenario'];
    title: string;
    systemId: string;
    jobName: string;
    incidentKey: string;
    evidenceVersion: number;
    requiredPermission: 'job-action';
    steps: RunbookStepDefinition[];
    rollback: string;
}

export interface RunbookStepExecution {
    stepId: string;
    status: RunbookStepStatus;
    operator?: string;
    startedAt?: string;
    completedAt?: string;
    input?: Record<string, string>;
    output?: string;
    outcome?: RecoveryVerificationResult['status'] | 'succeeded';
}

export interface RunbookExecution {
    schema: 'imonitor-runbook-execution';
    version: 1;
    id: string;
    runbookId: string;
    systemId: string;
    jobName: string;
    incidentKey: string;
    evidenceVersion: number;
    operator: string;
    status: RunbookExecutionStatus;
    currentStepIndex: number;
    steps: RunbookStepExecution[];
    createdAt: string;
    updatedAt: string;
    outcome?: RecoveryVerificationResult;
}

export interface RunbookExecutionStore {
    executions: RunbookExecution[];
}

export const DEFAULT_RUNBOOK_EXECUTIONS: RunbookExecutionStore = { executions: [] };

const COMMON_STEP_DATA: Record<AlertKind, RunbookStepDefinition[]> = {
    messageWait: [
        {
            id: 'confirm-message', title: 'Confirm the current inquiry', kind: 'check',
            requiredEvidence: ['job', 'messages'], confirmationRequired: false,
            expectedOutcome: 'The job is still in MSGW and the inquiry key and queue are current.',
            stopCondition: 'Stop if the job leaves MSGW or the message identity cannot be verified.'
        },
        {
            id: 'send-approved-reply', title: 'Send the approved reply', kind: 'action', action: 'replyMessage',
            requiredEvidence: ['job', 'messages'], confirmationRequired: true,
            expectedOutcome: 'IBM i accepts the SNDRPY request without removing the message.',
            stopCondition: 'Stop if the reply context is stale, unsupported, or permission is lost.'
        },
        {
            id: 'verify-message-recovery', title: 'Verify the message wait cleared', kind: 'verify',
            requiredEvidence: ['job'], confirmationRequired: false,
            expectedOutcome: 'A fresh job read shows the workload is no longer waiting for a reply.',
            stopCondition: 'Keep the runbook paused or escalate if the job remains in MSGW.'
        }
    ],
    lockWait: [
        {
            id: 'inspect-lock-context', title: 'Inspect the current lock context', kind: 'check',
            requiredEvidence: ['job', 'queue', 'subsystem'], confirmationRequired: false,
            expectedOutcome: 'The waiting job, subsystem, and lock counts are current.',
            stopCondition: 'Stop if the job is unavailable or the lock owner cannot be established.'
        },
        {
            id: 'verify-lock-recovery', title: 'Verify the lock wait cleared', kind: 'verify',
            requiredEvidence: ['job'], confirmationRequired: false,
            expectedOutcome: 'A fresh job read shows the lock wait is gone.',
            stopCondition: 'Escalate before any disruptive action when the lock wait remains.'
        }
    ],
    highCpu: [
        {
            id: 'capture-cpu-context', title: 'Capture current CPU context', kind: 'check',
            requiredEvidence: ['job', 'jobLog'], confirmationRequired: false,
            expectedOutcome: 'The job CPU and recent log context are current.',
            stopCondition: 'Stop if the job or supporting evidence is unavailable.'
        },
        {
            id: 'verify-cpu-recovery', title: 'Verify CPU recovery', kind: 'verify',
            requiredEvidence: ['job'], confirmationRequired: false,
            expectedOutcome: 'A fresh job read shows CPU has returned below the configured threshold.',
            stopCondition: 'Escalate if high CPU persists or a disruptive action would be required.'
        }
    ],
    pollFailure: [
        {
            id: 'confirm-monitoring-recovery', title: 'Confirm monitoring and workload recovery', kind: 'verify',
            requiredEvidence: ['trigger'], confirmationRequired: false,
            expectedOutcome: 'A fresh authenticated poll succeeds and the workload is separately verified.',
            stopCondition: 'Do not treat reconnect alone as workload recovery.'
        }
    ],
    delayWait: [],
    dequeueWait: []
};

/** Builds the immutable v1 procedure used by the guarded execution flow. */
export function buildCommonRunbookDefinition(input: {
    policy: RunbookPolicy;
    systemId: string;
    jobName: string;
    incidentKey: string;
    evidenceVersion?: number;
}): RunbookDefinition {
    const steps = (COMMON_STEP_DATA[input.policy.scenario === 'disconnect' ? 'pollFailure' : input.policy.scenario] || [])
        .map((step) => ({ ...step, requiredEvidence: [...step.requiredEvidence] }));
    return {
        schema: 'imonitor-runbook',
        version: 1,
        id: `${input.policy.id}:${input.systemId}:${input.jobName}`,
        policyId: input.policy.id,
        scenario: input.policy.scenario,
        title: input.policy.title,
        systemId: input.systemId,
        jobName: input.jobName,
        incidentKey: input.incidentKey,
        evidenceVersion: Math.max(1, Math.round(input.evidenceVersion || 1)),
        requiredPermission: 'job-action',
        steps,
        rollback: 'Stop the runbook and escalate. No automatic rollback or disruptive recovery is performed.'
    };
}

export function createRunbookExecution(definition: RunbookDefinition, operator: string, now: string, id = `runbook-execution-${Date.now()}`): RunbookExecution {
    return {
        schema: 'imonitor-runbook-execution', version: 1, id, runbookId: definition.id,
        systemId: definition.systemId, jobName: definition.jobName, incidentKey: definition.incidentKey,
        evidenceVersion: definition.evidenceVersion, operator: operator.trim() || 'local-operator', status: 'ready',
        currentStepIndex: 0, steps: definition.steps.map((step) => ({ stepId: step.id, status: 'pending' })),
        createdAt: now, updatedAt: now
    };
}

export function startRunbookExecution(execution: RunbookExecution, operator: string, now: string): RunbookExecution {
    if (execution.status !== 'ready' && execution.status !== 'paused') return execution;
    return { ...execution, operator: operator.trim() || execution.operator, status: 'running', updatedAt: now };
}

export function getCurrentRunbookStep(definition: RunbookDefinition, execution: RunbookExecution) {
    return definition.steps[execution.currentStepIndex];
}

export function completeRunbookStep(input: {
    definition: RunbookDefinition;
    execution: RunbookExecution;
    operator: string;
    output: string;
    outcome?: RecoveryVerificationResult;
    now: string;
    input?: Record<string, string>;
}): RunbookExecution {
    const { definition, execution } = input;
    const step = getCurrentRunbookStep(definition, execution);
    if (!step || execution.status !== 'running') return execution;
    const success = !input.outcome || input.outcome.status === 'recovered';
    const steps: RunbookStepExecution[] = execution.steps.map((record, index) => index === execution.currentStepIndex
        ? {
            ...record, status: success ? 'succeeded' as const : 'failed' as const, operator: input.operator.trim() || execution.operator,
            startedAt: record.startedAt || input.now, completedAt: input.now, input: input.input, output: input.output,
            outcome: input.outcome?.status || 'succeeded'
        }
        : record);
    if (!success) {
        return {
            ...execution, steps, status: input.outcome?.status === 'still-blocked' ? 'paused' : 'escalated',
            outcome: input.outcome, updatedAt: input.now
        };
    }
    const nextIndex = execution.currentStepIndex + 1;
    return {
        ...execution, steps, currentStepIndex: nextIndex,
        status: nextIndex >= definition.steps.length ? 'succeeded' : 'running',
        outcome: nextIndex >= definition.steps.length ? input.outcome : undefined,
        updatedAt: input.now
    };
}

export function normalizeRunbookExecutions(candidate?: Partial<RunbookExecutionStore>): RunbookExecutionStore {
    const executions = Array.isArray(candidate?.executions) ? candidate.executions : [];
    return {
        executions: executions.map(normalizeExecution).filter((execution): execution is RunbookExecution => Boolean(execution)).slice(0, 100)
    };
}

function normalizeExecution(candidate: RunbookExecution): RunbookExecution | null {
    if (!candidate || candidate.schema !== 'imonitor-runbook-execution' || candidate.version !== 1) return null;
    if (!String(candidate.id || '').trim() || !String(candidate.runbookId || '').trim() || !String(candidate.systemId || '').trim()) return null;
    const status: RunbookExecutionStatus[] = ['ready', 'running', 'paused', 'succeeded', 'failed', 'escalated'];
    if (!status.includes(candidate.status)) return null;
    return {
        ...candidate,
        id: String(candidate.id).trim().slice(0, 120), runbookId: String(candidate.runbookId).trim().slice(0, 240),
        systemId: String(candidate.systemId).trim().slice(0, 120), jobName: String(candidate.jobName || '').trim().slice(0, 240),
        incidentKey: String(candidate.incidentKey || '').trim().slice(0, 240), operator: String(candidate.operator || 'local-operator').trim().slice(0, 120),
        evidenceVersion: Math.max(1, Math.round(Number(candidate.evidenceVersion) || 1)),
        currentStepIndex: Math.max(0, Math.round(Number(candidate.currentStepIndex) || 0)),
        steps: Array.isArray(candidate.steps) ? candidate.steps.slice(0, 20) : [],
        createdAt: validDate(candidate.createdAt) ? candidate.createdAt : new Date(0).toISOString(),
        updatedAt: validDate(candidate.updatedAt) ? candidate.updatedAt : new Date(0).toISOString()
    };
}

function validDate(value: string | undefined) {
    return Boolean(value) && !Number.isNaN(Date.parse(value as string));
}

export function buildJobRecoveryVerification(job: ActiveJobRecord | null | undefined, observedAt = new Date().toISOString()): RecoveryVerificationResult {
    if (!job) return { status: 'unknown', summary: 'The job was not returned by the verification read.', observedAt, evidence: ['Job: unavailable'] };
    const status = String(job.STATUS || '').trim().toUpperCase();
    if (status === 'MSGW' || status === 'LCKW' || Number(job.DATABASE_LOCK_WAITS || 0) > 0) {
        return { status: 'still-blocked', summary: `The job remains in ${status || 'a blocked'} state.`, observedAt, evidence: [`Job status: ${status || 'unknown'}`] };
    }
    if (status === 'END' || status === 'EOJ') {
        return { status: 'failed', summary: 'The job ended before the runbook verified recovery.', observedAt, evidence: [`Job status: ${status}`] };
    }
    return { status: 'recovered', summary: `The job is active in ${status || 'an available'} state.`, observedAt, evidence: [`Job status: ${status || 'unknown'}`] };
}
