import { ipcMain } from 'electron/main';
import type { ActiveJobRecord } from '../../services/ibmi';
import type { JobStatusHistoryEntry } from '../../features/monitoring/monitoring-model';
import type { OperatorActionKind } from '../../features/operator-actions/operator-actions';

interface RegisterJobsIpcDependencies {
    getJob: (jobName: string) => ActiveJobRecord | undefined;
    getJobStatusHistory: (jobName: string) => JobStatusHistoryEntry[];
    buildWaitReason: (job: ActiveJobRecord) => string;
    buildJobRootCauseGuidance: (job: ActiveJobRecord) => unknown;
    getAvailableOperatorActions: (job: ActiveJobRecord) => unknown[];
    getAlertSettings: () => { highCpuThreshold: number };
    buildOperatorActionPlan: (payload: {
        kind: OperatorActionKind;
        jobName: string;
        replyText?: string;
        endOption?: 'controlled' | 'immediate';
    }) => { executionType: 'cl' | 'blocked'; command?: string; reason?: string; };
    runOperatorCommand: (command: string, payload: { kind: OperatorActionKind; jobName: string; }, live: boolean) => Promise<void>;
    isLiveMonitorMode: () => boolean;
    recordActivity: (entry: {
        area: 'monitoring';
        level: 'success' | 'error';
        message: string;
        detail?: string;
    }) => void;
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

    ipcMain.handle('run-job-action', async (_event, payload: {
        kind: OperatorActionKind;
        jobName: string;
        replyText?: string;
        endOption?: 'controlled' | 'immediate';
    }) => {
        const job = dependencies.getJob(payload.jobName);
        if (!job) {
            return { success: false, error: 'The selected job is no longer available.' };
        }

        const plan = dependencies.buildOperatorActionPlan(payload);
        if (plan.executionType === 'blocked' || !plan.command) {
            return { success: false, error: plan.reason || 'This action is not available yet.' };
        }

        try {
            await dependencies.runOperatorCommand(plan.command, payload, dependencies.isLiveMonitorMode());
            return { success: true, message: `Action completed: ${payload.kind}` };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown action failure';
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
