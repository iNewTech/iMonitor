import type { ActiveJobRecord } from '../../services/ibmi';
import type { MonitorAlert } from '../../features/alerts/alert-model';
import type { MonitoringSnapshot } from '../../features/monitoring/monitoring-model';
import { buildAiAssistantContext } from '../../features/ibmeyeai/ai-context';
import { buildAiAssistantPrompt } from '../../features/ibmeyeai/ai-prompt';
import { buildAlertDiagnosticPrompt } from '../../features/ibmeyeai/alert-diagnostic';
import { findApplicableResolutions, type ResolutionMemoryStore } from '../../features/action-board/resolution-memory';
import { buildActionPlannerSnapshot, type ActionPlannerSnapshot } from '../../features/action-board/action-planner';
import { getAvailableOperatorActions } from '../../features/action-board/operator-actions';
import { getRunbookPolicy } from '../../features/action-board/runbook-policy';
import { JOB_REPLY_SECTIONS, validateGroundedReply, type GroundedReplyValidation } from '../../features/ibmeyeai/grounded-guidance';
import type {
    AiAssistantAvailability,
    AiAssistantMessage,
    AiAssistantSettings
} from '../../features/ibmeyeai/ai-model';
import type { JobStatusHistoryEntry } from '../../features/monitoring/monitoring-model';
import { createAiProviderRegistry } from './ibmeyeai/providers';
import type { ActivityLogEntry, MonitorMode } from '../types';
import type { KnowledgeAccessContext } from '../../features/knowledge/knowledge-access';
import type { KnowledgeIndexGateway } from '../../features/knowledge/knowledge-index';
import { retrieveJobKnowledgeContext, type JobKnowledgeContextResult } from '../../features/ibmeyeai/job-knowledge';
import type { ObservabilityAuditCategory, ObservabilityMetricName } from '../../features/observability/observability-ledger';

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
    getCurrentSystemId?: () => string | undefined;
    getResolutionMemory?: () => ResolutionMemoryStore;
    getAvailableOperatorActions?: typeof getAvailableOperatorActions;
    getKnowledgeAccessContext?: () => KnowledgeAccessContext;
    getKnowledgeIndexGateway?: () => Pick<KnowledgeIndexGateway, 'search' | 'health'>;
    recordActivity: (entry: Omit<ActivityLogEntry, 'id' | 'timestamp'>) => void;
    recordMetric?: (name: ObservabilityMetricName, value: number, attributes?: Record<string, string | number | boolean>) => void;
    recordAudit?: (category: ObservabilityAuditCategory, name: string, outcome?: 'success' | 'failure' | 'denied' | 'warning', attributes?: Record<string, string | number | boolean>) => void;
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
        const linkedAlert = scopedAlerts.find((alert) => alert.jobName === requestedJobName) ?? scopedAlerts[0] ?? null;
        const approvedResolutions = isJobScoped && selectedJob && dependencies.getCurrentSystemId && dependencies.getResolutionMemory
            ? findApplicableResolutions({
                systemId: dependencies.getCurrentSystemId() || '',
                job: selectedJob,
                alert: linkedAlert
            }, dependencies.getResolutionMemory())
            : [];
        const actionPlanner: ActionPlannerSnapshot | undefined = isJobScoped && selectedJob
            ? buildActionPlannerSnapshot({
                job: selectedJob,
                operatorActions: (dependencies.getAvailableOperatorActions || getAvailableOperatorActions)(selectedJob),
                incident: linkedAlert ? {
                    id: linkedAlert.incidentId || linkedAlert.id,
                    title: linkedAlert.title,
                    status: linkedAlert.workflowStatus,
                    owner: linkedAlert.owner || ''
                } : undefined,
                runbook: getRunbookPolicy(linkedAlert?.kind),
                ragResolutions: approvedResolutions
            })
            : undefined;
        let groundedKnowledge: JobKnowledgeContextResult | undefined;
        const retrievalStartedAt = Date.now();
        if (isJobScoped && selectedJob && dependencies.getKnowledgeAccessContext && dependencies.getKnowledgeIndexGateway) {
            groundedKnowledge = await retrieveJobKnowledgeContext({
                job: selectedJob,
                alert: linkedAlert,
                access: dependencies.getKnowledgeAccessContext(),
                index: dependencies.getKnowledgeIndexGateway()
            });
            dependencies.recordMetric?.('retrieval_latency_ms', Date.now() - retrievalStartedAt, { resultCount: groundedKnowledge.contextPack.records.length, fallback: groundedKnowledge.retrievalHealth?.fallbackUsed === true });
        }
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
            highCpuThreshold: dependencies.getHighCpuThreshold?.(),
            approvedResolutions,
            knowledgeContextPack: groundedKnowledge?.contextPack
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
        dependencies.recordMetric?.('context_characters', enrichedContext.length, { scope: payload.scope || 'monitor' });
        const modelStartedAt = Date.now();

        try {
            const providerClient = providerRegistry.getProviderClient(settings);
            const reply = await providerClient.ask(settings, model, messages);

            if (!reply) {
                throw new Error(`${availability.providerLabel} returned an empty response.`);
            }

            const validation: GroundedReplyValidation = validateGroundedReply(
                reply,
                isJobScoped,
                isJobScoped ? JOB_REPLY_SECTIONS : undefined,
                isJobScoped ? groundedKnowledge?.contextPack.citations.map((citation) => citation.id) : undefined
            );
            dependencies.recordActivity({
                area: 'ai',
                level: 'info',
                message: 'IBMEye AI analysis completed.',
                detail: `${availability.providerLabel} / ${model} analyzed the current monitor context.${validation.valid ? '' : ` Missing sections or citations: ${[...validation.missingSections, ...validation.missingCitations].join(', ')}.`}`
            });
            dependencies.recordMetric?.('model_latency_ms', Date.now() - modelStartedAt, { provider: availability.providerLabel, model });
            dependencies.recordMetric?.('estimated_tokens', Math.ceil((enrichedContext.length + validation.reply.length) / 4), { provider: availability.providerLabel, model });
            dependencies.recordAudit?.('provider', 'model-request', 'success', { provider: availability.providerLabel, model });

            return {
                success: true,
                reply: validation.reply,
                availability,
                validation,
                supportContext: groundedKnowledge?.supportContext,
                contextPack: groundedKnowledge?.contextPack,
                retrievalHealth: groundedKnowledge?.retrievalHealth,
                actionPlanner
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            dependencies.recordActivity({
                area: 'ai',
                level: 'error',
                message: 'IBMEye AI analysis failed.',
                detail: message
            });
            dependencies.recordMetric?.('provider_error', 1, { provider: availability.providerLabel, model: model || 'unavailable' });
            dependencies.recordAudit?.('provider', 'model-request', 'failure', { provider: availability.providerLabel, model: model || 'unavailable' });

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
