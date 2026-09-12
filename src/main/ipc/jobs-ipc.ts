import { ipcMain } from 'electron/main';
import type { ActiveJobRecord, JobMessageRecord, JobQueueRecord, PagedResult, QueuedJobRecord } from '../../services/ibmi';
import type { JobStatusHistoryEntry } from '../../features/monitoring/monitoring-model';
import type { IncidentResponseSnapshot } from '../../features/alerts/incident-response';
import type { OperatorActionKind } from '../../features/action-board/operator-actions';
import { createActionAuditEntry } from '../../features/action-board/action-audit';
import {
    buildJobQueueActionPlan,
    requiresJobQueueConfirmation,
    type JobQueueActionKind
} from '../../features/action-board/job-queue-actions';
import type { JobQueueQuery, QueuedJobQuery } from '../../features/action-board/job-queue-model';
import type { QueueTriageResult } from '../../features/action-board/queue-triage';
import type { RecoveryVerificationResult } from '../../features/action-board/recovery-verification';
import { createActionLeaseStore } from '../../features/action-board/action-leases';
import type { AuthorizationResult, ProtectedAction } from '../../features/action-board/operator-access';
import type { ResourceGraph } from '../../features/alerts/resource-graph';
import { validateMessageReplyContext } from '../../features/action-board/runbook-policy';

interface RegisterJobsIpcDependencies {
    requirePremium: () => void;
    getJob: (jobName: string) => ActiveJobRecord | undefined;
    getJobStatusHistory: (jobName: string) => JobStatusHistoryEntry[];
    getIncidentResponse: (jobName: string) => IncidentResponseSnapshot | null;
    getJobResourceGraph: (jobName: string) => Promise<ResourceGraph>;
    getJobContext: (jobName: string) => Promise<Record<string, unknown>>;
    getJobLog: (jobName: string) => Promise<unknown[]>;
    getJobMessages: (jobName: string) => Promise<JobMessageRecord[]>;
    getRunbook: (jobName: string) => unknown;
    getJobQueues: (options: JobQueueQuery) => Promise<PagedResult<JobQueueRecord>>;
    getJobQueueDetails: (queueName: string, queueLibrary: string) => Promise<{
        queue: Record<string, unknown> | null;
        subsystem: Record<string, unknown> | null;
    }>;
    getQueuedJobs: (options: QueuedJobQuery) => Promise<PagedResult<QueuedJobRecord>>;
    getQueueTriage: () => QueueTriageResult[];
    verifyJobQueueAction: (payload: {
        kind: JobQueueActionKind;
        queueName: string;
        queueLibrary: string;
        jobName?: string;
    }) => Promise<RecoveryVerificationResult>;
    isQueuedJob: (jobName: string) => Promise<boolean>;
    runJobQueueCommand: (
        command: string,
        payload: { kind: JobQueueActionKind; queueName: string; queueLibrary: string; jobName?: string },
        live: boolean
    ) => Promise<void>;
    buildWaitReason: (job: ActiveJobRecord) => string;
    buildJobRootCauseGuidance: (job: ActiveJobRecord) => unknown;
    getAvailableOperatorActions: (job: ActiveJobRecord) => unknown[];
    getAlertSettings: () => { highCpuThreshold: number };
    buildOperatorActionPlan: (payload: {
        kind: OperatorActionKind;
        jobName: string;
        replyText?: string;
        messageKey?: string;
        messageQueue?: string;
        endOption?: 'controlled' | 'immediate';
    }) => { executionType: 'cl' | 'blocked'; command?: string; reason?: string; };
    runOperatorCommand: (command: string, payload: { kind: OperatorActionKind; jobName: string; }, live: boolean) => Promise<void>;
    isLiveMonitorMode: () => boolean;
    getOperatorName: () => string;
    authorizeAction: (action: ProtectedAction, systemId: string | undefined) => AuthorizationResult;
    getCurrentSystemId: () => string | undefined;
    recordActivity: (entry: {
        area: 'monitoring';
        level: 'success' | 'error';
        message: string;
        detail?: string;
    }) => void;
    recordActionAudit: (entry: ReturnType<typeof createActionAuditEntry>) => void;
    sendToWindow: (channel: string, payload: unknown) => void;
}

/**
 * Registers job-detail and operator-action IPC handlers for the main process.
 */
export function registerJobsIpc(dependencies: RegisterJobsIpcDependencies) {
    const actionLeases = createActionLeaseStore();
    const authorizeRead = () => dependencies.authorizeAction('read', dependencies.getCurrentSystemId());
    ipcMain.handle('get-job-details', (_event, jobName: string) => {
        if (!authorizeRead().allowed) return null;
        const job = dependencies.getJob(jobName);
        if (!job) {
            return null;
        }

        return {
            job,
            statusHistory: dependencies.getJobStatusHistory(jobName),
            response: dependencies.getIncidentResponse(jobName),
            runbook: dependencies.getRunbook(jobName),
            waitReason: dependencies.buildWaitReason(job),
            guidance: dependencies.buildJobRootCauseGuidance(job),
            actions: dependencies.getAvailableOperatorActions(job)
        };
    });

    ipcMain.handle('get-job-context', async (_event, jobName: string) => {
        const authorization = authorizeRead();
        if (!authorization.allowed) return { success: false, error: authorization.reason || 'The operator cannot inspect jobs.' };
        if (!dependencies.getJob(jobName)) {
            return { success: false, error: 'The selected job is no longer available.' };
        }

        try {
            return { success: true, ...(await dependencies.getJobContext(jobName)) };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unable to load IBM i job properties.'
            };
        }
    });

    ipcMain.handle('get-job-resource-graph', async (_event, jobName: string) => {
        const authorization = authorizeRead();
        if (!authorization.allowed) return { success: false, graph: null, error: authorization.reason || 'The operator cannot inspect job relationships.' };
        if (!dependencies.getJob(jobName)) {
            return { success: false, graph: null, error: 'The selected job is no longer available.' };
        }

        try {
            return { success: true, graph: await dependencies.getJobResourceGraph(jobName) };
        } catch (error) {
            return {
                success: false,
                graph: null,
                error: error instanceof Error ? error.message : 'Unable to build the job relationship graph.'
            };
        }
    });

    ipcMain.handle('get-job-log', async (_event, jobName: string) => {
        const authorization = authorizeRead();
        if (!authorization.allowed) return { success: false, records: [], error: authorization.reason || 'The operator cannot inspect job logs.' };
        if (!dependencies.getJob(jobName)) {
            return { success: false, error: 'The selected job is no longer available.', records: [] };
        }

        try {
            return { success: true, records: await dependencies.getJobLog(jobName) };
        } catch (error) {
            return {
                success: false,
                records: [],
                error: error instanceof Error ? error.message : 'Unable to load the job log.'
            };
        }
    });

    ipcMain.handle('get-job-messages', async (_event, jobName: string) => {
        const authorization = authorizeRead();
        if (!authorization.allowed) return { success: false, records: [], error: authorization.reason || 'The operator cannot inspect job messages.' };
        if (!dependencies.getJob(jobName)) {
            return { success: false, error: 'The selected job is no longer available.', records: [] };
        }

        try {
            return { success: true, records: await dependencies.getJobMessages(jobName) };
        } catch (error) {
            return {
                success: false,
                records: [],
                error: error instanceof Error ? error.message : 'Unable to load job messages.'
            };
        }
    });

    ipcMain.handle('get-job-queues', async (_event, options: JobQueueQuery = {}) => {
        const authorization = authorizeRead();
        if (!authorization.allowed) return { success: false, data: [], hasMore: false, nextCursor: null, error: authorization.reason || 'The operator cannot inspect job queues.' };
        try {
            return { success: true, ...(await dependencies.getJobQueues(options)) };
        } catch (error) {
            return {
                success: false,
                data: [],
                hasMore: false,
                nextCursor: null,
                error: error instanceof Error ? error.message : 'Unable to load IBM i job queues.'
            };
        }
    });

    ipcMain.handle('get-job-queue-details', async (_event, payload: {
        queueName?: string;
        queueLibrary?: string;
    } = {}) => {
        const authorization = authorizeRead();
        if (!authorization.allowed) return { success: false, queue: null, subsystem: null, error: authorization.reason || 'The operator cannot inspect job queues.' };
        const queueName = typeof payload.queueName === 'string' ? payload.queueName.trim() : '';
        const queueLibrary = typeof payload.queueLibrary === 'string' ? payload.queueLibrary.trim() : 'QGPL';
        if (!queueName || !queueLibrary || queueName.includes('..') || queueLibrary.includes('..')) {
            return { success: false, queue: null, subsystem: null, error: 'Choose a valid job queue.' };
        }

        try {
            return { success: true, ...(await dependencies.getJobQueueDetails(queueName, queueLibrary)) };
        } catch (error) {
            return {
                success: false,
                queue: null,
                subsystem: null,
                error: error instanceof Error ? error.message : 'Unable to load job queue details.'
            };
        }
    });

    ipcMain.handle('get-queued-jobs', async (_event, options: QueuedJobQuery = {}) => {
        const authorization = authorizeRead();
        if (!authorization.allowed) return { success: false, data: [], hasMore: false, nextCursor: null, error: authorization.reason || 'The operator cannot inspect queued jobs.' };
        try {
            return { success: true, ...(await dependencies.getQueuedJobs(options)) };
        } catch (error) {
            return {
                success: false,
                data: [],
                hasMore: false,
                nextCursor: null,
                error: error instanceof Error ? error.message : 'Unable to load queued IBM i jobs.'
            };
        }
    });

    ipcMain.handle('get-queue-triage', () => ({
        success: true,
        results: authorizeRead().allowed ? dependencies.getQueueTriage() : []
    }));

    ipcMain.handle('run-job-action', async (_event, payload: {
        kind: OperatorActionKind;
        jobName: string;
        replyText?: string;
        messageKey?: string;
        messageQueue?: string;
        endOption?: 'controlled' | 'immediate';
        confirmed?: boolean;
        executionId?: string;
        systemId?: string;
    }) => {
        dependencies.requirePremium();
        const systemId = dependencies.getCurrentSystemId();
        if (payload.systemId && payload.systemId !== systemId) {
            return { success: false, error: 'This job action targets a different IBM i system.' };
        }
        const authorization = dependencies.authorizeAction('job-action', systemId);
        if (!authorization.allowed) {
            return { success: false, error: authorization.reason || 'The operator is not allowed to run job actions.' };
        }
        const job = dependencies.getJob(payload.jobName);
        if (!job) {
            return { success: false, error: 'The selected job is no longer available.' };
        }

        if (payload.kind === 'replyMessage') {
            try {
                const validation = validateMessageReplyContext(job, await dependencies.getJobMessages(payload.jobName), payload);
                if (!validation.valid) return { success: false, error: validation.reason };
            } catch (error) {
                return { success: false, error: error instanceof Error ? error.message : 'Unable to verify the current message.' };
            }
        }

        const plan = dependencies.buildOperatorActionPlan(payload);
        if (plan.executionType === 'blocked' || !plan.command) {
            return { success: false, error: plan.reason || 'This action is not available yet.' };
        }

        if (requiresConfirmation(payload.kind) && payload.confirmed !== true) {
            return { success: false, error: 'This job action requires operator confirmation.' };
        }

        const actionKey = `job:${systemId}:${payload.jobName}`;
        const executionId = payload.executionId?.trim() || `${actionKey}:${Date.now()}`;
        const leaseResult = actionLeases.acquire(actionKey, executionId, dependencies.getOperatorName());
        if (!leaseResult.granted) {
            return { success: false, error: formatLeaseRejection(leaseResult.reason, 'job action') };
        }

        try {
            const latestAuthorization = dependencies.authorizeAction('job-action', dependencies.getCurrentSystemId());
            if (!latestAuthorization.allowed) {
                return { success: false, error: latestAuthorization.reason || 'Support access changed before the job action could run.' };
            }
            await dependencies.runOperatorCommand(plan.command, payload, dependencies.isLiveMonitorMode());
            dependencies.recordActionAudit(createActionAuditEntry({
                operator: dependencies.getOperatorName(),
                jobName: payload.jobName,
                action: payload.kind,
                result: 'success',
                detail: `${plan.command} | execution=${leaseResult.lease.executionId}`
            }));
            return { success: true, message: `Action completed: ${payload.kind}` };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown action failure';
            dependencies.recordActionAudit(createActionAuditEntry({
                operator: dependencies.getOperatorName(),
                jobName: payload.jobName,
                action: payload.kind,
                result: 'failure',
                detail: errorMessage
            }));
            dependencies.recordActivity({
                area: 'monitoring',
                level: 'error',
                message: `Operator action failed: ${payload.kind}.`,
                detail: `${payload.jobName} | ${errorMessage}`
            });
            return { success: false, error: errorMessage };
        } finally {
            actionLeases.complete(leaseResult.lease);
        }
    });

    ipcMain.handle('run-job-queue-action', async (_event, payload: {
        kind: JobQueueActionKind;
        queueName: string;
        queueLibrary: string;
        jobName?: string;
        confirmed?: boolean;
        executionId?: string;
        systemId?: string;
    }) => {
        try {
            dependencies.requirePremium();
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Job queue actions require Premium.'
            };
        }
        const systemId = dependencies.getCurrentSystemId();
        if (payload.systemId && payload.systemId !== systemId) {
            return { success: false, error: 'This queue action targets a different IBM i system.' };
        }
        const authorization = dependencies.authorizeAction('queue-action', systemId);
        if (!authorization.allowed) {
            return { success: false, error: authorization.reason || 'The operator is not allowed to run queue actions.' };
        }
        const plan = buildJobQueueActionPlan(payload);
        if (plan.executionType === 'blocked' || !plan.command) {
            return { success: false, error: plan.reason || 'This queue action is not available.' };
        }

        if (
            (payload.kind === 'holdQueuedJob' || payload.kind === 'releaseQueuedJob')
            && (!payload.jobName || !(await dependencies.isQueuedJob(payload.jobName)))
        ) {
            return { success: false, error: 'The selected queued job is no longer available.' };
        }

        if (payload.jobName) {
            const currentJobs = await dependencies.getQueuedJobs({ search: payload.jobName, status: 'ALL', limit: 10 });
            const currentJob = currentJobs.data.find((job) => job.JOB_NAME === payload.jobName);
            if (!currentJob || currentJob.JOB_QUEUE_NAME !== payload.queueName || currentJob.JOB_QUEUE_LIBRARY !== payload.queueLibrary) {
                return { success: false, error: 'The queued job moved or changed; refresh before trying again.' };
            }
            const currentStatus = String(currentJob.JOB_STATUS || currentJob.JOB_QUEUE_STATUS || '').toUpperCase();
            if (payload.kind === 'releaseQueuedJob' && currentStatus !== 'HELD') {
                return { success: false, error: `The queued job is currently ${currentStatus || 'unavailable'}; refresh before releasing it.` };
            }
            if (payload.kind === 'holdQueuedJob' && currentStatus === 'HELD') {
                return { success: false, error: 'The queued job is already held; refresh before trying again.' };
            }
        }

        if (requiresJobQueueConfirmation(payload.kind) && payload.confirmed !== true) {
            return { success: false, error: 'This queue action requires operator confirmation.' };
        }

        const actionKey = `queue:${systemId}:${payload.queueLibrary}/${payload.queueName}/${payload.jobName || 'queue'}`;
        const executionId = payload.executionId?.trim() || `${actionKey}:${Date.now()}`;
        const leaseResult = actionLeases.acquire(actionKey, executionId, dependencies.getOperatorName());
        if (!leaseResult.granted) {
            return { success: false, error: formatLeaseRejection(leaseResult.reason, 'queue action') };
        }

        try {
            if (payload.kind === 'holdQueue' || payload.kind === 'releaseQueue') {
                const currentQueue = await dependencies.getJobQueueDetails(payload.queueName, payload.queueLibrary);
                const currentStatus = String(currentQueue.queue?.JOB_QUEUE_STATUS || currentQueue.queue?.STATUS || '').toUpperCase();
                if (!currentQueue.queue) {
                    return { success: false, error: 'The selected job queue is no longer available.' };
                }
                if (payload.kind === 'releaseQueue' && currentStatus !== 'HELD') {
                    return { success: false, error: `The queue is currently ${currentStatus || 'unavailable'}; refresh before releasing it.` };
                }
                if (payload.kind === 'holdQueue' && currentStatus === 'HELD') {
                    return { success: false, error: 'The queue is already held; refresh before trying again.' };
                }
            }
            const latestAuthorization = dependencies.authorizeAction('queue-action', dependencies.getCurrentSystemId());
            if (!latestAuthorization.allowed) {
                return { success: false, error: latestAuthorization.reason || 'Support access changed before the queue action could run.' };
            }
            await dependencies.runJobQueueCommand(
                plan.command,
                payload,
                dependencies.isLiveMonitorMode()
            );
            dependencies.recordActionAudit(createActionAuditEntry({
                operator: dependencies.getOperatorName(),
                jobName: payload.jobName || `${payload.queueLibrary}/${payload.queueName}`,
                action: payload.kind,
                result: 'success',
                detail: `${plan.command} | execution=${leaseResult.lease.executionId}`
            }));
            const verification = await dependencies.verifyJobQueueAction(payload);
            dependencies.recordActionAudit(createActionAuditEntry({
                operator: dependencies.getOperatorName(),
                jobName: payload.jobName || `${payload.queueLibrary}/${payload.queueName}`,
                action: `${payload.kind}:verification`,
                result: verification.status === 'recovered' ? 'success' : 'failure',
                detail: `${verification.summary} | ${verification.evidence.join('; ')}`
            }));
            dependencies.sendToWindow('job-queue-action-verification', verification);
            dependencies.sendToWindow('job-queues-updated', {
                queueName: payload.queueName,
                queueLibrary: payload.queueLibrary,
                jobName: payload.jobName,
                action: payload.kind
            });
            return { success: true, message: verification.summary, verification };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown queue action failure';
            dependencies.recordActionAudit(createActionAuditEntry({
                operator: dependencies.getOperatorName(),
                jobName: payload.jobName || `${payload.queueLibrary}/${payload.queueName}`,
                action: payload.kind,
                result: 'failure',
                detail: errorMessage
            }));
            dependencies.recordActivity({
                area: 'monitoring',
                level: 'error',
                message: `Job queue action failed: ${payload.kind}.`,
                detail: `${payload.queueLibrary}/${payload.queueName} | ${errorMessage}`
            });
            return { success: false, error: errorMessage };
        } finally {
            actionLeases.complete(leaseResult.lease);
        }
    });
}

function requiresConfirmation(kind: OperatorActionKind) {
    return kind === 'holdJob' || kind === 'releaseJob' || kind === 'endJob' || kind === 'replyMessage';
}

function formatLeaseRejection(reason: 'duplicate' | 'replay', label: string) {
    return reason === 'replay'
        ? `This ${label} request was already submitted.`
        : `This ${label} is already in progress.`;
}
