import { ipcMain } from 'electron/main';
import type { ActiveJobRecord, JobMessageRecord } from '../../services/ibmi';
import type { IncidentResponseSnapshot } from '../../features/alerts/incident-response';
import { createActionAuditEntry } from '../../features/action-board/action-audit';
import { buildOperatorActionPlan, type OperatorActionKind } from '../../features/action-board/operator-actions';
import {
    buildJobRecoveryVerification,
    buildCommonRunbookDefinition,
    completeRunbookStep,
    createRunbookExecution,
    getCurrentRunbookStep,
    normalizeRunbookExecutions,
    startRunbookExecution,
    type RunbookDefinition,
    type RunbookExecution,
    type RunbookExecutionStore
} from '../../features/action-board/runbook-execution';
import { validateMessageReplyContext } from '../../features/action-board/runbook-policy';
import type { AuthorizationResult, ProtectedAction } from '../../features/action-board/operator-access';

interface RunbookIpcDependencies {
    requirePremium: () => void;
    getSystemId: () => string | undefined;
    getOperatorName: () => string;
    authorizeAction: (action: ProtectedAction, systemId: string | undefined) => AuthorizationResult;
    getJob: (jobName: string) => ActiveJobRecord | undefined;
    getJobLog: (jobName: string) => Promise<unknown[]>;
    getJobMessages: (jobName: string) => Promise<JobMessageRecord[]>;
    getIncidentResponse: (jobName: string) => IncidentResponseSnapshot | null;
    getHighCpuThreshold: () => number;
    getExecutions: () => RunbookExecutionStore;
    saveExecutions: (store: RunbookExecutionStore) => RunbookExecutionStore;
    buildOperatorActionPlan: typeof buildOperatorActionPlan;
    runOperatorCommand: (command: string, payload: { kind: OperatorActionKind; jobName: string; replyText?: string; messageKey?: string; messageQueue?: string }, live: boolean) => Promise<void>;
    isLiveMonitorMode: () => boolean;
    recordActionAudit: (entry: ReturnType<typeof createActionAuditEntry>) => void;
}

type RunbookPayload = {
    jobName: string;
    executionId?: string;
    replyText?: string;
    messageKey?: string;
    messageQueue?: string;
    confirmed?: boolean;
};

/** Registers the persisted, checkpointed runbook execution boundary. */
export function registerRunbookIpc(dependencies: RunbookIpcDependencies) {
    const authorizeRead = () => dependencies.authorizeAction('read', dependencies.getSystemId());
    const getDefinition = (jobName: string): RunbookDefinition | null => {
        const systemId = dependencies.getSystemId();
        const response = dependencies.getIncidentResponse(jobName);
        const policy = response?.runbook;
        if (!systemId || !policy) return null;
        return buildCommonRunbookDefinition({
            policy,
            systemId,
            jobName,
            incidentKey: response.incidentKey
        });
    };
    const getStoredExecution = (jobName: string, definition: RunbookDefinition) => dependencies.getExecutions().executions
        .filter((execution) => execution.systemId === definition.systemId && execution.jobName === jobName && execution.runbookId === definition.id)
        .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0];
    const saveExecution = (execution: RunbookExecution) => dependencies.saveExecutions({
        executions: [execution, ...dependencies.getExecutions().executions.filter((item) => item.id !== execution.id)].slice(0, 100)
    });

    ipcMain.handle('get-verified-runbook', (_event, jobName: string) => {
        if (!authorizeRead().allowed) return { success: false, definition: null, execution: null, error: 'The operator cannot inspect runbooks.' };
        const definition = getDefinition(jobName);
        if (!definition) return { success: true, definition: null, execution: null };
        return { success: true, definition, execution: getStoredExecution(jobName, definition) || null };
    });

    ipcMain.handle('start-verified-runbook', (_event, payload: { jobName: string }) => {
        try {
            dependencies.requirePremium();
            const systemId = dependencies.getSystemId();
            const authorization = dependencies.authorizeAction('job-action', systemId);
            if (!authorization.allowed) return { success: false, error: authorization.reason || 'The operator cannot start a runbook.' };
            const jobName = String(payload?.jobName || '').trim();
            const job = dependencies.getJob(jobName);
            const definition = getDefinition(jobName);
            if (!job || !definition) return { success: false, error: 'A current incident with a supported runbook is required.' };
            const existing = getStoredExecution(jobName, definition);
            if (existing && ['ready', 'running', 'paused'].includes(existing.status)) return { success: true, definition, execution: existing };
            const now = new Date().toISOString();
            const execution = startRunbookExecution(
                createRunbookExecution(definition, dependencies.getOperatorName(), now),
                dependencies.getOperatorName(),
                now
            );
            saveExecution(execution);
            dependencies.recordActionAudit(createActionAuditEntry({
                operator: dependencies.getOperatorName(), jobName, action: 'runbook-started', result: 'success',
                incidentId: definition.incidentKey, detail: `${definition.policyId} | execution=${execution.id}`
            }));
            return { success: true, definition, execution };
        } catch (error) {
            return { success: false, error: error instanceof Error ? error.message : 'Unable to start the runbook.' };
        }
    });

    ipcMain.handle('run-verified-runbook-step', async (_event, payload: RunbookPayload) => {
        try {
            dependencies.requirePremium();
            const systemId = dependencies.getSystemId();
            const authorization = dependencies.authorizeAction('job-action', systemId);
            if (!authorization.allowed) return { success: false, error: authorization.reason || 'The operator cannot run this checkpoint.' };
            const jobName = String(payload?.jobName || '').trim();
            const definition = getDefinition(jobName);
            const currentJob = dependencies.getJob(jobName);
            if (!definition || !currentJob) return { success: false, error: 'The job or its supported runbook is no longer available.' };
            const stored = getStoredExecution(jobName, definition);
            if (!stored || (payload.executionId && stored.id !== payload.executionId)) return { success: false, error: 'Start the current runbook before running a checkpoint.' };
            let execution = startRunbookExecution(stored, dependencies.getOperatorName(), new Date().toISOString());
            const step = getCurrentRunbookStep(definition, execution);
            if (!step) return { success: false, error: 'The runbook has no remaining checkpoint.' };
            const now = new Date().toISOString();
            const stepInput = compactInput(payload);
            let output = '';
            let outcome;
            if (step.kind === 'check') {
                const messages = step.id === 'confirm-message' ? await dependencies.getJobMessages(jobName) : [];
                if (step.id === 'confirm-message' && !hasCurrentInquiry(currentJob, messages)) {
                    outcome = { status: 'failed' as const, summary: 'The current MSGW inquiry could not be confirmed.', observedAt: now, evidence: ['Job/message identity: unavailable or stale'] };
                } else {
                    if (step.id === 'capture-cpu-context') await dependencies.getJobLog(jobName);
                    output = describeCheck(currentJob, messages);
                }
            } else if (step.kind === 'action') {
                if (step.confirmationRequired && payload.confirmed !== true) return { success: false, error: 'This runbook step requires explicit operator confirmation.' };
                if (step.action !== 'replyMessage') return { success: false, error: 'This runbook action is not enabled in the current release.' };
                const messages = await dependencies.getJobMessages(jobName);
                const validation = validateMessageReplyContext(currentJob, messages, payload);
                if (!validation.valid) return { success: false, error: validation.reason };
                const plan = dependencies.buildOperatorActionPlan({
                    kind: step.action,
                    jobName,
                    replyText: payload.replyText,
                    messageKey: payload.messageKey,
                    messageQueue: payload.messageQueue
                });
                if (plan.executionType === 'blocked' || !plan.command) return { success: false, error: plan.reason || 'The runbook action is unavailable.' };
                await dependencies.runOperatorCommand(plan.command, {
                    kind: step.action,
                    jobName,
                    replyText: payload.replyText,
                    messageKey: payload.messageKey,
                    messageQueue: payload.messageQueue
                }, dependencies.isLiveMonitorMode());
                output = `Executed ${plan.command}`;
            } else {
                const verification = buildJobRecoveryVerification(currentJob, now);
                if (definition.scenario === 'highCpu' && Number(currentJob.CPU || 0) >= dependencies.getHighCpuThreshold()) {
                    outcome = { ...verification, status: 'still-blocked' as const, summary: `CPU remains at ${currentJob.CPU}% and is above the configured threshold.` };
                } else {
                    outcome = verification;
                }
                output = outcome.summary;
            }
            const updated = completeRunbookStep({ definition, execution, operator: dependencies.getOperatorName(), output, outcome, input: stepInput, now });
            execution = updated;
            saveExecution(execution);
            const success = execution.status === 'succeeded' || !outcome || outcome.status === 'recovered';
            dependencies.recordActionAudit(createActionAuditEntry({
                operator: dependencies.getOperatorName(), jobName, action: `runbook:${step.id}`, result: success ? 'success' : 'failure',
                incidentId: definition.incidentKey, detail: `${output || outcome?.summary || 'Checkpoint completed'} | execution=${execution.id}`
            }));
            return { success: true, definition, execution, message: output || outcome?.summary || 'Checkpoint completed.' };
        } catch (error) {
            return { success: false, error: error instanceof Error ? error.message : 'Unable to run the checkpoint.' };
        }
    });
}

function hasCurrentInquiry(job: ActiveJobRecord, messages: JobMessageRecord[]) {
    return String(job.STATUS || '').trim().toUpperCase() === 'MSGW'
        && messages.some((message) => String(message.MESSAGE_TYPE || '').trim().toUpperCase() === 'INQUIRY');
}

function describeCheck(job: ActiveJobRecord, messages: JobMessageRecord[]) {
    const status = String(job.STATUS || 'unknown').trim().toUpperCase();
    return messages.length ? `Current job status: ${status}. ${messages.length} message context record(s) captured.` : `Current job status: ${status}.`;
}

function compactInput(payload: RunbookPayload) {
    return Object.fromEntries(Object.entries({
        replyText: payload.replyText, messageKey: payload.messageKey, messageQueue: payload.messageQueue
    }).filter(([, value]) => typeof value === 'string' && value.trim()).map(([key, value]) => [key, String(value).trim().slice(0, 200)]));
}
