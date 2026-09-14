import { buildOperatorActionPlan } from '../../features/action-board/operator-actions';
import type { buildIncidentResponseSnapshot } from '../../features/alerts/incident-response';
import type { MonitorAlert } from '../../features/alerts/alert-model';
import type { McpActionContext, McpActionExecutionRequest, McpActionVerification } from '../../features/mcp/mcp-actions';
import type { McpResourceDependencies, McpResourceItem } from '../../features/mcp/mcp-resources';
import { getJobKey } from '../../features/monitoring/monitoring-model';
import type Db from '../../services/ibmi';
import { registerMcpIpc } from '../ipc/mcp-ipc';
import type { createMonitoringStateStore } from '../state/monitoring-state';
import { getNormalizedMcpRegistry, getNormalizedResolutionMemory, saveMcpRegistry, type AppStore } from '../store';
import type { createKnowledgeRuntime } from './knowledge-runtime';

type McpResourceInput = Parameters<McpResourceDependencies['getItems']>[0];
type JobControlAction = Exclude<McpActionExecutionRequest['operatorAction'], 'replyMessage'>;

const VERIFIED_JOB_STATUSES: Record<JobControlAction, readonly string[]> = {
    holdJob: ['HLD', 'HELD'],
    releaseJob: ['RUN', 'RUNNING', 'ACTIVE'],
    endJob: ['END', 'EOJ']
};

interface McpRuntimeDependencies {
    store: AppStore;
    monitoringState: Pick<ReturnType<typeof createMonitoringStateStore>,
        'getJob' | 'getLatestJobs' | 'getMonitoringHistory' | 'getMonitorMode'>;
    getActiveAlerts: () => MonitorAlert[];
    getRunbookPolicyForJob: (jobName: string) => ReturnType<typeof buildIncidentResponseSnapshot>['runbook'] | undefined;
    getCurrentOperatorName: () => string;
    getCurrentService: () => Pick<Db, 'executeClCommand'> | null;
    publishSystemStatus: () => Promise<void>;
    knowledgeRuntime: Pick<ReturnType<typeof createKnowledgeRuntime>,
        'getAccessContext' | 'recordActivity' | 'recordMetric' | 'recordAudit'>;
    recordCommandActivity: ReturnType<typeof createKnowledgeRuntime>['recordActivity'];
}

/** Adapts current operational state to the existing MCP resource and approved-action gateways. */
export function createMcpRuntime(dependencies: McpRuntimeDependencies) {
    const { store, monitoringState, getRunbookPolicyForJob, getCurrentOperatorName, knowledgeRuntime } = dependencies;

    function getMcpResourceItems(request: McpResourceInput): McpResourceItem[] {
        const jobName = request.jobName?.trim();
        const promptResource: Record<string, string> = {
            'job-health-summary': 'ibmi://jobs/current',
            'incident-review': 'imonitor://runbooks/approved',
            'resolution-review': 'imonitor://resolution-memory/approved'
        };
        const name = request.kind === 'prompt' ? promptResource[request.name] || request.name : request.name;
        const source = (id: string, title: string, content: unknown, observedAt: string, kind: McpResourceItem['sourceRef']['kind']): McpResourceItem => ({
            id,
            title,
            content: JSON.stringify(content),
            observedAt,
            sourceRef: { kind, id, locator: `imonitor://${request.scope.systemScope}/${encodeURIComponent(id)}` }
        });

        if (name === 'ibmi://jobs/current') {
            const history = monitoringState.getMonitoringHistory();
            const observedAt = history[history.length - 1]?.timestamp || '';
            return monitoringState.getLatestJobs()
                .filter((job) => !jobName || String(job.JOB_NAME || job.SUBSYSTEM_JOB || '').trim() === jobName)
                .slice(0, 100)
                .map((job) => {
                    const id = String(job.JOB_NAME || job.SUBSYSTEM_JOB || 'job').trim();
                    return source(id, `Current job ${id}`, {
                        qualifiedName: id,
                        jobNumber: job.JOB_NUMBER,
                        user: job.JOB_USER || job.CURRENT_USER,
                        subsystem: job.SUBSYSTEM,
                        status: job.STATUS,
                        cpu: job.CPU,
                        cpuTime: job.CPU_TIME,
                        function: job.FUNCTION_NAME,
                        databaseLockWaits: job.DATABASE_LOCK_WAITS,
                        nonDatabaseLockWaits: job.NON_DATABASE_LOCK_WAITS,
                        messageReply: job.MESSAGE_REPLY
                    }, observedAt, 'job');
                });
        }

        if (name === 'ibmi://incidents/current') {
            return dependencies.getActiveAlerts()
                .filter((alert) => !jobName || alert.jobName === jobName)
                .slice(0, 100)
                .map((alert) => {
                    const evidenceSources = ['trigger', 'job', 'jobLog', 'messages', 'queue', 'subsystem'] as const;
                    const evidence = Object.fromEntries(evidenceSources.flatMap((key) => {
                        const snapshot = alert.evidence?.[key];
                        if (!snapshot) return [];
                        return [[key, {
                            status: snapshot.status,
                            recordCount: snapshot.recordCount,
                            collectedAt: snapshot.collectedAt,
                            detail: snapshot.detail
                        }]];
                    }));
                    const id = String(alert.incidentId || alert.id).trim();
                    return source(id, alert.title, {
                        incidentId: id,
                        kind: alert.kind,
                        severity: alert.severity,
                        lifecyclePhase: alert.lifecyclePhase,
                        workflowStatus: alert.workflowStatus,
                        jobName: alert.jobName,
                        message: alert.message,
                        detail: alert.detail,
                        owner: alert.owner,
                        evidence,
                        lastSeenAt: alert.lastSeenAt || alert.timestamp
                    }, alert.lastSeenAt || alert.timestamp, 'incident');
                });
        }

        if (name === 'imonitor://runbooks/approved') {
            const alerts = dependencies.getActiveAlerts().filter((alert) => !jobName || alert.jobName === jobName);
            return alerts.flatMap((alert) => {
                const policy = alert.jobName ? getRunbookPolicyForJob(alert.jobName) : undefined;
                if (!policy) return [];
                return [source(policy.id, policy.title, { status: 'approved', policy }, alert.lastSeenAt || alert.timestamp, 'record')];
            }).slice(0, 50);
        }

        if (name === 'imonitor://resolution-memory/approved') {
            return getNormalizedResolutionMemory(store).entries
                .filter((entry) => entry.status === 'approved' && (entry.systemId === request.scope.systemScope || entry.systemId === '*'))
                .filter((entry) => !jobName || !entry.jobPattern || entry.jobPattern === jobName)
                .slice(0, 50)
                .map((entry) => source(entry.id, entry.title, {
                    status: entry.status,
                    version: entry.version,
                    systemId: entry.systemId,
                    incidentKind: entry.incidentKind,
                    jobPattern: entry.jobPattern,
                    symptoms: entry.symptoms,
                    evidenceRefs: entry.evidenceRefs,
                    successfulAction: entry.successfulAction,
                    verifiedOutcome: entry.verifiedOutcome,
                    environment: entry.environment,
                    reviewer: entry.reviewer,
                    approvedAt: entry.approvedAt
                }, entry.approvedAt || entry.createdAt, 'record'));
        }

        return [];
    }

    function getMcpActionContext(jobName: string): McpActionContext {
        const job = monitoringState.getJob(jobName);
        if (!job) throw new Error('The selected job is no longer available.');
        const history = monitoringState.getMonitoringHistory();
        const lastSnapshot = history[history.length - 1];
        const alert = dependencies.getActiveAlerts().find((candidate) => candidate.jobName === jobName);
        const capturedAt = lastSnapshot?.timestamp || alert?.evidence?.capturedAt || alert?.lastSeenAt || new Date().toISOString();
        return {
            evidence: {
                capturedAt,
                current: Boolean(lastSnapshot || alert?.evidence),
                summary: alert ? `${alert.title} · ${alert.workflowStatus}` : `Current job status: ${job.STATUS || 'UNKNOWN'}`
            }
        };
    }

    async function executeMcpAction(request: McpActionExecutionRequest) {
        if (request.signal?.aborted) throw new Error('MCP action cancelled.');
        const input = request.input;
        const plan = buildOperatorActionPlan({
            kind: request.operatorAction,
            jobName: request.jobName,
            replyText: typeof input.replyText === 'string' ? input.replyText : undefined,
            messageKey: typeof input.messageKey === 'string' ? input.messageKey : undefined,
            messageQueue: typeof input.messageQueue === 'string' ? input.messageQueue : undefined,
            endOption: input.endOption === 'immediate' ? 'immediate' : 'controlled'
        });
        if (plan.executionType === 'blocked' || !plan.command) throw new Error(plan.reason || 'The selected MCP action is not available.');
        const live = monitoringState.getMonitorMode() === 'live';
        if (!live) {
            dependencies.recordCommandActivity({
                area: 'monitoring', level: 'success',
                message: `Simulated MCP action: ${request.operatorAction}.`,
                detail: `${getCurrentOperatorName()} | ${request.jobName} | ${plan.command}`
            });
            return { output: `Prepared ${plan.command}` };
        }
        const service = dependencies.getCurrentService();
        if (!service) throw new Error('Not connected to IBM i');
        await service.executeClCommand(plan.command);
        dependencies.recordCommandActivity({
            area: 'monitoring', level: 'success',
            message: `MCP action completed: ${request.operatorAction}.`,
            detail: `${getCurrentOperatorName()} | ${request.jobName} | ${plan.command}`
        });
        return { output: `Executed ${plan.command}` };
    }

    async function verifyMcpAction(request: McpActionExecutionRequest): Promise<McpActionVerification> {
        if (request.signal?.aborted) throw new Error('MCP action verification cancelled.');
        if (monitoringState.getMonitorMode() !== 'live') {
            return {
                status: 'unknown',
                summary: 'The action was simulated; no IBM i recovery was verified.',
                evidence: ['Demo commands do not change the monitored job.']
            };
        }

        const previousHistory = monitoringState.getMonitoringHistory();
        const previousSnapshot = previousHistory[previousHistory.length - 1];

        // Verification owns the fresh read. A successful command alone is not recovery.
        try {
            await dependencies.publishSystemStatus();
        } catch {
            return {
                status: 'unknown',
                summary: 'The verification read failed; verify the job from the next monitoring poll.',
                evidence: ['Job: unavailable from the verification read']
            };
        }
        if (request.signal?.aborted) throw new Error('MCP action verification cancelled.');
        const history = monitoringState.getMonitoringHistory();
        const snapshot = history[history.length - 1];
        // The state store appends a new object per poll, even with equal timestamps
        // or a full history. A resolved refresh with the same object proves nothing.
        if (!snapshot || snapshot === previousSnapshot) {
            return {
                status: 'unknown',
                summary: 'The verification read produced no new monitoring snapshot; verify from the next poll.',
                evidence: ['Monitoring snapshot: unchanged or unavailable']
            };
        }
        const observedAt = snapshot.timestamp;
        const observationTime = Date.parse(observedAt);
        if (!Number.isFinite(observationTime)
            || (previousSnapshot && observationTime < Date.parse(previousSnapshot.timestamp))) {
            return {
                status: 'unknown',
                summary: 'The verification snapshot has an invalid or older observation time; verify from the next poll.',
                evidence: ['Monitoring snapshot: observation time could not establish fresh evidence']
            };
        }
        const job = monitoringState.getLatestJobs().find((candidate) => getJobKey(candidate) === request.jobName);
        if (!job) {
            return {
                status: 'unknown',
                summary: 'The job was not returned after the action; verify its state from the next poll.',
                evidence: ['Job: unavailable after action']
            };
        }
        const status = String(job.STATUS || '').trim().toUpperCase() || 'UNKNOWN';
        const recovered = request.operatorAction === 'replyMessage'
            ? status !== 'UNKNOWN' && status !== 'MSGW'
            : VERIFIED_JOB_STATUSES[request.operatorAction].includes(status);
        return {
            status: recovered ? 'recovered' : 'unknown',
            summary: recovered
                ? `The next monitoring read shows ${request.operatorAction} completed.`
                : `The next monitoring read still shows ${status}; verify before taking another action.`,
            evidence: [`Job status: ${status}`, `Observed at: ${observedAt}`]
        };
    }

    function registerIpc() {
        registerMcpIpc({
            getRegistry: () => getNormalizedMcpRegistry(store),
            saveRegistry: (candidate) => saveMcpRegistry(store, candidate),
            getAccessContext: knowledgeRuntime.getAccessContext,
            getResourceItems: getMcpResourceItems,
            getActionContext: getMcpActionContext,
            executeMcpAction,
            verifyMcpAction,
            recordActivity: knowledgeRuntime.recordActivity,
            recordMetric: knowledgeRuntime.recordMetric,
            recordActionAudit: (entry) => {
                knowledgeRuntime.recordActivity({
                    area: 'monitoring',
                    level: entry.result === 'success' ? 'success' : 'error',
                    message: `MCP action ${entry.result}: ${entry.action}.`,
                    detail: [`operator=${entry.operator}`, `job=${entry.jobName}`, entry.detail].filter(Boolean).join(' | ')
                });
                knowledgeRuntime.recordAudit('action', `mcp:${entry.action}`, entry.result === 'success' ? 'success' : 'failure');
            }
        });
    }

    return {
        getResourceItems: getMcpResourceItems,
        getActionContext: getMcpActionContext,
        execute: executeMcpAction,
        verify: verifyMcpAction,
        registerIpc
    };
}
