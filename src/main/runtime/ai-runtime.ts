import type { ActiveJobRecord } from '../../services/ibmi';
import type { MonitorAlert } from '../../features/alerts/alert-model';
import type { MonitoringSnapshot } from '../../features/monitoring/monitoring-model';
import { buildAiAssistantContext } from '../../features/ibmeyeai/ai-context';
import { buildAiAssistantPrompt } from '../../features/ibmeyeai/ai-prompt';
import { buildAlertDiagnosticPrompt } from '../../features/ibmeyeai/alert-diagnostic';
import type {
    AiAssistantAvailability,
    AiAssistantMessage,
    AiAssistantSettings
} from '../../features/ibmeyeai/ai-model';
import type { JobStatusHistoryEntry } from '../../features/monitoring/monitoring-model';
import { createAiProviderRegistry } from './ibmeyeai/providers';
import type { ActivityLogEntry, MonitorMode } from '../types';

interface AiRuntimeDependencies {
    appName: string;
    getSettings: () => AiAssistantSettings;
    getConnection: () => {
        name?: string | null;
        host?: string | null;
        user?: string | null;
        port?: number | null;
    } | null;
    getMonitorMode: () => MonitorMode;
    getLatestJobs: () => ActiveJobRecord[];
    getJob: (jobName: string) => ActiveJobRecord | undefined;
    getActiveAlerts: () => MonitorAlert[];
    getMonitoringHistory: () => MonitoringSnapshot[];
    getJobStatusHistory?: (jobName: string) => JobStatusHistoryEntry[];
    getActivityLog: () => ActivityLogEntry[];
    getHighCpuThreshold?: () => number;
    recordActivity: (entry: Omit<ActivityLogEntry, 'id' | 'timestamp'>) => void;
    fetchImpl?: typeof fetch;
}

/**
 * Creates the IBMEye AI runtime and delegates provider-specific work to dedicated modules.
 */
export function createAiRuntime(dependencies: AiRuntimeDependencies) {
    const providerRegistry = createAiProviderRegistry({
        fetchImpl: dependencies.fetchImpl
    });

    async function getAiAvailability(): Promise<AiAssistantAvailability> {
        const settings = dependencies.getSettings();
        return providerRegistry.getProviderClient(settings).getAvailability(settings);
    }

    async function askAssistant(payload: {
        message: string;
        selectedJobName?: string;
        conversation?: AiAssistantMessage[];
        additionalContext?: string;
        scope?: 'monitor' | 'job';
    }) {
        const settings = dependencies.getSettings();
        const availability = await getAiAvailability();

        if (!settings.enabled) {
            return {
                success: false,
                availability,
                error: 'AI assistant is turned off in settings.'
            };
        }

        if (!availability.healthy) {
            return {
                success: false,
                availability,
                error: availability.message
            };
        }

        const model = availability.selectedModel;
        if (!model) {
            return {
                success: false,
                availability,
                error: 'No model is available for the selected provider.'
            };
        }

        const isJobScoped = payload.scope === 'job';
        const requestedJobName = String(payload.selectedJobName ?? '').trim();
        if (isJobScoped && !requestedJobName) {
            return {
                success: false,
                availability,
                error: 'Select a job before using the job AI helper.'
            };
        }

        const selectedJob = requestedJobName
            ? dependencies.getJob(requestedJobName) ?? null
            : null;
        if (isJobScoped && !selectedJob) {
            return {
                success: false,
                availability,
                error: 'The selected job is no longer available. Refresh the task and try again.'
            };
        }

        const allJobs = dependencies.getLatestJobs();
        const allAlerts = dependencies.getActiveAlerts();
        const allActivity = dependencies.getActivityLog();
        const scopedJobs = isJobScoped && selectedJob ? [selectedJob] : allJobs;
        const scopedAlerts = isJobScoped
            ? allAlerts.filter((alert) => alert.jobName === requestedJobName)
            : allAlerts;
        const scopedActivity = isJobScoped && requestedJobName
            ? allActivity.filter((entry) => isJobRelatedActivity(entry, requestedJobName))
            : allActivity;
        const context = buildAiAssistantContext({
            appName: dependencies.appName,
            connection: dependencies.getConnection(),
            monitorMode: dependencies.getMonitorMode(),
            settings,
            latestJobs: scopedJobs,
            alerts: scopedAlerts,
            monitoringHistory: isJobScoped ? [] : dependencies.getMonitoringHistory(),
            activityLog: scopedActivity,
            selectedJob,
            selectedJobHistory: isJobScoped && requestedJobName
                ? dependencies.getJobStatusHistory?.(requestedJobName)
                : undefined,
            scope: payload.scope,
            highCpuThreshold: dependencies.getHighCpuThreshold?.()
        });
        const enrichedContext = !isJobScoped && payload.additionalContext?.trim()
            ? `${context}\n\n${payload.additionalContext.trim()}`
            : context;
        const messages = buildAiAssistantPrompt({
            question: payload.message,
            context: enrichedContext,
            conversation: isJobScoped ? undefined : payload.conversation,
            scope: payload.scope,
            replyStyle: settings.replyStyle
        });

        try {
            const providerClient = providerRegistry.getProviderClient(settings);
            const reply = await providerClient.ask(settings, model, messages);

            if (!reply) {
                throw new Error(`${availability.providerLabel} returned an empty response.`);
            }

            dependencies.recordActivity({
                area: 'ai',
                level: 'info',
                message: 'IBMEye AI analysis completed.',
                detail: `${availability.providerLabel} / ${model} analyzed the current monitor context.`
            });

            return {
                success: true,
                reply,
                availability
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            dependencies.recordActivity({
                area: 'ai',
                level: 'error',
                message: 'IBMEye AI analysis failed.',
                detail: message
            });

            return {
                success: false,
                availability,
                error: message
            };
        }
    }

    /**
     * Creates a support-oriented diagnostic for one newly created alert.
     */
    async function analyzeAlert(alert: MonitorAlert) {
        return askAssistant({
            message: buildAlertDiagnosticPrompt(alert),
            selectedJobName: alert.jobName
        });
    }

    return {
        getAiAvailability,
        askAssistant,
        analyzeAlert
    };
}

function isJobRelatedActivity(entry: ActivityLogEntry, jobName: string) {
    const needle = jobName.toLowerCase();
    return [entry.message, entry.detail, entry.sql]
        .some((value) => String(value ?? '').toLowerCase().includes(needle));
}
