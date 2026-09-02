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

        const selectedJob = payload.selectedJobName
            ? dependencies.getJob(payload.selectedJobName) ?? null
            : null;
        const context = buildAiAssistantContext({
            appName: dependencies.appName,
            connection: dependencies.getConnection(),
            monitorMode: dependencies.getMonitorMode(),
            settings,
            latestJobs: dependencies.getLatestJobs(),
            alerts: dependencies.getActiveAlerts(),
            monitoringHistory: dependencies.getMonitoringHistory(),
            activityLog: dependencies.getActivityLog(),
            selectedJob,
            highCpuThreshold: dependencies.getHighCpuThreshold?.()
        });
        const messages = buildAiAssistantPrompt({
            question: payload.message,
            context,
            conversation: payload.conversation,
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
