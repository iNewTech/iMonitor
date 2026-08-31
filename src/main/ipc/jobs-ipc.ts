import { ipcMain } from 'electron/main';
import type { ActiveJobRecord } from '../../services/ibmi';
import type { JobStatusHistoryEntry } from '../../features/monitoring/monitoring-model';
import type { OperatorActionKind } from '../../features/action-board/operator-actions';
import { createActionAuditEntry } from '../../features/action-board/action-audit';

interface RegisterJobsIpcDependencies {
    getJob: (jobName: string) => ActiveJobRecord | undefined;
    getJobStatusHistory: (jobName: string) => JobStatusHistoryEntry[];
    getJobContext: (jobName: string) => Promise<Record<string, unknown>>;
    getJobLog: (jobName: string) => Promise<unknown[]>;
    getJobMessages: (jobName: string) => Promise<unknown[]>;
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
    recordActivity: (entry: {
        area: 'monitoring';
        level: 'success' | 'error';
        message: string;
        detail?: string;
    }) => void;
    recordActionAudit: (entry: ReturnType<typeof createActionAuditEntry>) => void;
}

/**
 * Registers job-detail and operator-action IPC handlers for the main process.
 */
export function registerJobsIpc(dependencies: RegisterJobsIpcDependencies) {
    ipcMain.handle('get-job-details', (_event, jobName: string) => {
        const job = dependencies.getJob(jobName);
        if (!job) {
            return null;
        }

        return {
            job,
            statusHistory: dependencies.getJobStatusHistory(jobName),
            waitReason: dependencies.buildWaitReason(job),
            guidance: dependencies.buildJobRootCauseGuidance(job),
            actions: dependencies.getAvailableOperatorActions(job)
        };
    });

    ipcMain.handle('get-job-context', async (_event, jobName: string) => {
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

    ipcMain.handle('get-job-log', async (_event, jobName: string) => {
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

    ipcMain.handle('run-job-action', async (_event, payload: {
        kind: OperatorActionKind;
        jobName: string;
        replyText?: string;
        messageKey?: string;
        messageQueue?: string;
        endOption?: 'controlled' | 'immediate';
        confirmed?: boolean;
    }) => {
        const job = dependencies.getJob(payload.jobName);
        if (!job) {
            return { success: false, error: 'The selected job is no longer available.' };
        }

        const plan = dependencies.buildOperatorActionPlan(payload);
        if (plan.executionType === 'blocked' || !plan.command) {
            return { success: false, error: plan.reason || 'This action is not available yet.' };
        }

        if (requiresConfirmation(payload.kind) && payload.confirmed !== true) {
            return { success: false, error: 'This job action requires operator confirmation.' };
        }

        try {
            await dependencies.runOperatorCommand(plan.command, payload, dependencies.isLiveMonitorMode());
            dependencies.recordActionAudit(createActionAuditEntry({
                operator: dependencies.getOperatorName(),
                jobName: payload.jobName,
                action: payload.kind,
                result: 'success',
                detail: plan.command
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
        }
    });
}

function requiresConfirmation(kind: OperatorActionKind) {
    return kind === 'holdJob' || kind === 'releaseJob' || kind === 'endJob' || kind === 'replyMessage';
}
