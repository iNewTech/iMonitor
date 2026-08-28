import type { ActiveJobRecord } from '../../services/ibmi';
import type { MonitorAlert } from '../../features/alerts/alert-model';
import type { MonitoringSnapshot } from '../../features/monitoring/monitoring-model';
import { buildAiAssistantContext } from '../../features/ai/ai-context';
import { resolvePreferredOllamaModel } from '../../features/ai/ai-model';
import { buildAiAssistantPrompt } from '../../features/ai/ai-prompt';
import type {
    AiAssistantAvailability,
    AiAssistantMessage,
    AiAssistantSettings
} from '../../features/ai/ai-model';
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
    recordActivity: (entry: Omit<ActivityLogEntry, 'id' | 'timestamp'>) => void;
    fetchImpl?: typeof fetch;
}

interface OllamaTagsResponse {
    models?: Array<{
        name?: string;
        model?: string;
    }>;
}

interface OllamaChatResponse {
    message?: {
        content?: string;
    };
}

/**
 * Creates the local AI assistant runtime backed by Ollama.
 */
export function createAiRuntime(dependencies: AiRuntimeDependencies) {
    const fetchImpl = dependencies.fetchImpl ?? fetch;

    async function requestJson<T>(url: string, init?: RequestInit, timeoutMs = 12000): Promise<T> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const response = await fetchImpl(url, {
                ...init,
                signal: controller.signal,
                headers: {
                    'Content-Type': 'application/json',
                    ...(init?.headers ?? {})
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status} ${response.statusText}`);
            }

            return await response.json() as T;
        } finally {
            clearTimeout(timer);
        }
    }

    async function getOllamaModels(endpoint: string) {
        const payload = await requestJson<OllamaTagsResponse>(`${endpoint}/api/tags`, undefined, 5000);
        return (payload.models ?? [])
            .map((model) => model.name || model.model || '')
            .filter(Boolean);
    }

    async function getAiAvailability(): Promise<AiAssistantAvailability> {
        const settings = dependencies.getSettings();

        try {
            const availableModels = await getOllamaModels(settings.endpoint);
            const selectedModel = resolvePreferredOllamaModel(availableModels, settings.model);

            return {
                enabled: settings.enabled,
                provider: settings.provider,
                endpoint: settings.endpoint,
                selectedModel,
                availableModels,
                healthy: true,
                featureAccess: 'included',
                message: selectedModel
                    ? `Ollama is available with ${availableModels.length} local model${availableModels.length === 1 ? '' : 's'}. Using ${selectedModel}.`
                    : 'Ollama is reachable, but no local model is installed yet.'
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return {
                enabled: settings.enabled,
                provider: settings.provider,
                endpoint: settings.endpoint,
                selectedModel: settings.model || null,
                availableModels: [],
                healthy: false,
                featureAccess: 'included',
                message: `Ollama is unavailable: ${message}`
            };
        }
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
                error: 'No Ollama model is installed. Pull a model locally first.'
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
            selectedJob
        });
        const messages = buildAiAssistantPrompt({
            question: payload.message,
            context,
            conversation: payload.conversation,
            replyStyle: settings.replyStyle
        });

        try {
            const response = await requestJson<OllamaChatResponse>(`${settings.endpoint}/api/chat`, {
                method: 'POST',
                body: JSON.stringify({
                    model,
                    stream: false,
                    messages,
                    options: {
                        temperature: settings.temperature
                    }
                })
            });
            const reply = response.message?.content?.trim();

            if (!reply) {
                throw new Error('Ollama returned an empty response.');
            }

            dependencies.recordActivity({
                area: 'ai',
                level: 'info',
                message: 'IBMEye AI analysis completed.',
                detail: `${model} analyzed the current monitor context.`
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

    return {
        getAiAvailability,
        askAssistant
    };
}
