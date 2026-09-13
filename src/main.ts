import { app, BrowserWindow, dialog, ipcMain } from 'electron/main';
import { Notification, nativeImage, safeStorage, shell } from 'electron';
import os from 'node:os';
import * as path from 'path';
import Db, { type ServiceLogEntry } from './services/ibmi';
import type { JobQueueRecord, PagedResult, QueuedJobRecord } from './services/ibmi';
import { DemoDatabase } from './services/demo-db';
import { IbmiObjectAnalysisService } from './services/object-analysis-live';
import {
    acknowledgeAlertWorkflow,
    addAlertWorkflowNote,
    attachClickUpTaskToWorkflow,
    attachJiraIssueToWorkflow,
    claimAlertWorkflow,
    markAlertWorkDone,
    releaseAlertWorkflow
} from './features/alerts/alert-operator-workflow';
import {
    normalizeAlertSettings,
    shouldWatchAlert,
    type MonitorAlert,
    type StoredAlertWorkflowState
} from './features/alerts/alert-model';
import { captureIncidentEvidence } from './features/alerts/incident-evidence';
import { buildIncidentResponseSnapshot } from './features/alerts/incident-response';
import { buildResourceGraph } from './features/alerts/resource-graph';
import type { IncidentHandoff } from './features/alerts/incident-handoff';
import { getDemoAvailability } from './features/demo/demo-runtime';
import { buildJobRootCauseGuidance } from './features/guidance/root-cause-guidance';
import { buildFallbackAlertDiagnostic } from './features/ibmeyeai/alert-diagnostic';
import { buildWaitReason, getJobKey, toNumber } from './features/monitoring/monitoring-model';
import {
    normalizeEmailNotificationSettings,
    toRenderableEmailNotificationSettings,
    toStoredEmailNotificationSettings,
    type EmailNotificationSettings
} from './features/notifications/email-notification';
import {
    getAiProviderCatalog,
    normalizeAiAssistantSettings,
    toRenderableAiAssistantSettings,
    toStoredAiAssistantSettings,
    type AiAssistantSettings
} from './features/ibmeyeai/ai-model';
import {
    normalizeClickUpSettings,
    toRenderableClickUpSettings,
    toStoredClickUpSettings,
    type ClickUpSettings
} from './features/integrations/clickup/clickup-model';
import {
    normalizeSlackSettings,
    toRenderableSlackSettings,
    toStoredSlackSettings,
    type SlackSettings
} from './features/integrations/slack/slack-model';
import {
    normalizeJiraSettings,
    toRenderableJiraSettings,
    toStoredJiraSettings,
    type JiraSettings
} from './features/integrations/jira/jira-model';
import {
    normalizeSmsNotificationSettings,
    toRenderableSmsNotificationSettings,
    toStoredSmsNotificationSettings,
    type SmsNotificationSettings
} from './features/notifications/sms-notification';
import {
    buildOperatorActionPlan,
    getAvailableOperatorActions,
    type OperatorActionKind
} from './features/action-board/operator-actions';
import type { JobQueueActionKind } from './features/action-board/job-queue-actions';
import { buildQueueRecoveryVerification, type RecoveryVerificationResult } from './features/action-board/recovery-verification';
import {
    authorizeOperatorAction,
    createLocalOperatorSession,
    type AuthorizationResult,
    type ProtectedAction
} from './features/action-board/operator-access';
import { authorizeSupportAccess, getEffectiveSupportAccessGrant, isClientOwner, listSupportAccessGrants } from './features/action-board/support-access';
import { toKnowledgeGrantSnapshot, type KnowledgeAccessContext } from './features/knowledge/knowledge-access';
import { createKnowledgeStore } from './features/knowledge/knowledge-store';
import { createKnowledgeIndexGateway, createLocalKnowledgeIndexAdapter, getKnowledgeIndexCatalog, normalizeKnowledgeIndexSettings, toStoredKnowledgeIndexSettings, type KnowledgeIndexSettings } from './features/knowledge/knowledge-index';
import type { McpResourceDependencies, McpResourceItem } from './features/mcp/mcp-resources';
import {
    ALWAYS_ON_SUPPORT_WINDOW,
    buildRoutingRecommendation,
    type RoutingOperator
} from './features/action-board/incident-routing';
import {
    normalizeJobQueueRecord,
    normalizeQueuedJobRecord,
    type JobQueueQuery,
    type QueuedJobQuery
} from './features/action-board/job-queue-model';
import { createAlertStateStore } from './main/state/alert-state';
import { createConnectionStateStore } from './main/state/connection-state';
import { createMonitoringStateStore } from './main/state/monitoring-state';
import { registerAlertsIpc } from './main/ipc/alerts-ipc';
import { registerAiIpc } from './main/ipc/ai-ipc';
import { registerConnectionIpc } from './main/ipc/connection-ipc';
import { registerClickUpIpc } from './main/ipc/clickup-ipc';
import { registerJobsIpc } from './main/ipc/jobs-ipc';
import { registerLogsIpc } from './main/ipc/logs-ipc';
import { registerNavigationIpc } from './main/ipc/navigation-ipc';
import { registerObjectAnalysisIpc } from './main/ipc/object-analysis-ipc';
import { registerSlackIpc } from './main/ipc/slack-ipc';
import { registerJiraIpc } from './main/ipc/jira-ipc';
import { registerSmsIpc } from './main/ipc/sms-ipc';
import { registerSupportIpc } from './main/ipc/support-ipc';
import { registerSupportAccessIpc } from './main/ipc/support-access-ipc';
import { registerResolutionMemoryIpc } from './main/ipc/resolution-memory-ipc';
import { registerRunbookIpc } from './main/ipc/runbook-ipc';
import { registerProblemManagementIpc } from './main/ipc/problem-management-ipc';
import { registerIncidentReplayIpc } from './main/ipc/incident-replay-ipc';
import { registerSupportMetricsIpc } from './main/ipc/support-metrics-ipc';
import { registerKnowledgeIpc } from './main/ipc/knowledge-ipc';
import { registerKnowledgeIndexIpc } from './main/ipc/knowledge-index-ipc';
import { registerMcpIpc } from './main/ipc/mcp-ipc';
import { createAiRuntime } from './main/runtime/ai-runtime';
import { createEmailNotificationRuntime } from './main/runtime/email-notification-runtime';
import { createClickUpRuntime } from './main/runtime/clickup-runtime';
import { createMonitoringRuntime } from './main/runtime/monitoring-runtime';
import { createQueueTriageRuntime } from './main/runtime/queue-triage-runtime';
import { createObjectAnalysisRuntime } from './main/runtime/object-analysis-runtime';
import { createWidgetSummaryRuntime } from './main/runtime/widget-summary-runtime';
import { createLoggingRuntime } from './main/runtime/logging-runtime';
import { createCollectionRuntime } from './main/runtime/collection-runtime';
import { createBackgroundCollectorRuntime } from './main/runtime/background-collector-runtime';
import { createSessionRuntime } from './main/runtime/session-runtime';
import { createSlackRuntime } from './main/runtime/slack-runtime';
import { createJiraRuntime } from './main/runtime/jira-runtime';
import { createSmsNotificationRuntime } from './main/runtime/sms-notification-runtime';
import { createSupportRuntime } from './main/runtime/support-runtime';
import {
    buildDeliveryEventKey,
    createDeliveryRegistry
} from './features/integrations/delivery';
import { encryptDiagnostics } from './features/support/diagnostic-crypto';
import { registerEntitlementsIpc } from './main/ipc/entitlements-ipc';
import {
    createEntitlementState,
    DEVELOPMENT_LICENSE_KEY,
    hasEntitlement,
    premiumRequiredMessage,
    type Plan,
    type FeatureId,
    type EntitlementState
} from './features/entitlements/entitlements';
import {
    createAppStore,
    getNormalizedAiAssistantSettings,
    getNormalizedAlertSettings,
    getNormalizedIncidentLedger,
    getNormalizedStoredClickUpSettings,
    getNormalizedStoredEmailNotificationSettings,
    getNormalizedStoredSlackSettings,
    getNormalizedThemeId,
    getNormalizedStoredJiraSettings,
    setStoredClickUpSettingsForUser,
    setStoredSlackSettingsForUser,
    setStoredJiraSettingsForUser,
    getNormalizedStoredSmsNotificationSettings,
    setStoredSmsNotificationSettingsForUser,
    getNormalizedObjectAnalysisSettings,
    getNormalizedQueueTriageResults,
    setObjectAnalysisSettings,
    getNormalizedSupportAccessGrants,
    getNormalizedCollectorSettings,
    getNormalizedBusinessServiceSettings,
    saveBusinessServiceSettings,
    getNormalizedResolutionMemory,
    saveResolutionMemory,
    getNormalizedRunbookExecutions,
    saveRunbookExecutions,
    getNormalizedProblemManagement,
    saveProblemManagement,
    getNormalizedKnowledgeIndexSettings,
    getNormalizedMcpRegistry,
    saveMcpRegistry
} from './main/store';
import type { CollectorSettings } from './features/collector/collector-model';
import { registerCollectorIpc } from './main/ipc/collector-ipc';
import { createWindowRuntime } from './main/window/window-runtime';
import { protectPassword, revealPassword } from './utils/password-store';
import { getDemoDatabasePath } from './utils/demo-system';
import {
    normalizeObjectAnalysisSettings,
    type ObjectAnalysisSettings
} from './features/object-analysis/model';

const DEFAULT_MONITORING_INTERVAL = 5000;
const MAX_ACTIVITY_LOG_ENTRIES = 200;
const MAX_MONITORING_HISTORY = 90;
const MAX_JOB_STATUS_HISTORY = 12;
const NOTIFICATION_COOLDOWN_MS = 120000;
const SUPPORT_EMAIL = 'gajendertyagi.tyagi@gmail.com';
const SUPPORT_DIAGNOSTICS_PUBLIC_KEY = process.env.IMONITOR_SUPPORT_PUBLIC_KEY?.trim() || '';
const LOCAL_OPERATOR_NAME = os.userInfo().username?.trim() || 'local-operator';
const DEMO_OPERATOR_NAME = 'GajenderT';
const OPERATOR_OVERRIDE = process.env.IMONITOR_OPERATOR_ID?.trim() || '';
const developmentBuild = !app.isPackaged || process.env.NODE_ENV === 'development';
const expectedDevelopmentLicenseKey = process.env.IMONITOR_DEV_LICENSE_KEY?.trim() || DEVELOPMENT_LICENSE_KEY;
let activatedDevelopmentLicenseKey = '';
let selectedDevelopmentPlan: Plan = developmentBuild ? 'premium' : 'free';

function getEntitlements(): EntitlementState {
    return createEntitlementState({
        development: developmentBuild,
        licenseKey: activatedDevelopmentLicenseKey,
        developmentPlan: selectedDevelopmentPlan,
        forceFree: process.env.IMONITOR_PREMIUM_DISABLED === '1'
    });
}

function requireEntitlement(feature: FeatureId) {
    if (!hasEntitlement(getEntitlements(), feature)) {
        throw new Error(premiumRequiredMessage(feature));
    }
}

function resolveAppIconPath() {
    if (app.isPackaged) {
        return path.join(process.resourcesPath, 'icons', 'icon.png');
    }

    return path.join(__dirname, '../build/icons/icon.png');
}

function resolveNotificationOptions(title: string, body: string) {
    const iconPath = resolveAppIconPath();
    const iconImage = nativeImage.createFromPath(iconPath);

    return {
        title: truncateForNotification(title, 64),
        body: truncateForNotification(body, 200),
        icon: iconImage.isEmpty() ? undefined : iconImage,
        contentImage: iconImage.isEmpty() ? undefined : iconImage
    };
}

const store = createAppStore();
const deliveryRegistry = createDeliveryRegistry(
    store.get('integrationDeliveryStatus'),
    (statuses) => store.set('integrationDeliveryStatus', statuses)
);
if (developmentBuild && store.get('developmentPlan') === 'free') {
    selectedDevelopmentPlan = 'free';
}
const connectionState = createConnectionStateStore();
let runtimeObjectAnalysisSettings: ObjectAnalysisSettings | null = null;
let runtimeObjectAnalysisContext = '';

function objectAnalysisContext(settings: ObjectAnalysisSettings) {
    return `${settings.source}|${settings.localDirectory}`;
}

/**
 * Loads the project/environment library list into session state. The Electron
 * store keeps the last runtime values for recovery, but a local setup file or
 * live IBM i environment wins when a project context is first opened.
 */
async function getObjectAnalysisRuntimeSettings() {
    const stored = getNormalizedObjectAnalysisSettings(store);
    const context = objectAnalysisContext(stored);
    if (runtimeObjectAnalysisSettings && runtimeObjectAnalysisContext === context) {
        return runtimeObjectAnalysisSettings;
    }

    let libraryList = stored.libraryList;
    if (stored.source === 'local') {
        try {
            const info = await getLocalObjectAnalysisService(stored).getLibraryListInfo();
            if (info.libraries.length) libraryList = info.libraries;
        } catch {
            // Let the workspace provide the useful directory error if the root is unavailable.
        }
    } else if (!isDemoSession() && connectionState.getState().isConnected) {
        try {
            const service = sessionRuntime.getCurrentService();
            if (service) libraryList = await new IbmiObjectAnalysisService(service).getEnvironmentLibraryList();
        } catch {
            // Keep the last runtime list until the live environment can be read.
        }
    }

    runtimeObjectAnalysisSettings = normalizeObjectAnalysisSettings({
        ...stored,
        libraryList,
        libraries: libraryList
    });
    runtimeObjectAnalysisContext = objectAnalysisContext(runtimeObjectAnalysisSettings);
    return runtimeObjectAnalysisSettings;
}

/** Applies settings for the current session and never writes the local setup file. */
async function setObjectAnalysisRuntimeSettings(candidate: Partial<ObjectAnalysisSettings> | undefined) {
    const current = await getObjectAnalysisRuntimeSettings();
    const next = normalizeObjectAnalysisSettings({ ...current, ...(candidate || {}) });
    store.set('objectAnalysisSettings', next);

    if (objectAnalysisContext(next) !== runtimeObjectAnalysisContext) {
        runtimeObjectAnalysisSettings = null;
        runtimeObjectAnalysisContext = '';
        return getObjectAnalysisRuntimeSettings();
    }

    runtimeObjectAnalysisSettings = next;
    return next;
}
const monitoringState = createMonitoringStateStore(
    MAX_MONITORING_HISTORY,
    MAX_JOB_STATUS_HISTORY,
    DEFAULT_MONITORING_INTERVAL
);

function getCredentialOptions() {
    return {
        safeStorage,
        encryptionKey: process.env.ENCRYPTION_KEY
    };
}

function getAlertSettings() {
    return getNormalizedAlertSettings(store);
}

function getThemeId() {
    return getNormalizedThemeId(store);
}

function getCurrentOperatorName() {
    if (OPERATOR_OVERRIDE) {
        return OPERATOR_OVERRIDE;
    }

    const currentConnection = connectionState.getState().currentConnection;
    const isDemoSession = monitoringState.getMonitorMode() === 'dummy'
        || currentConnection?.host === 'dummy.local'
        || currentConnection?.user === DEMO_OPERATOR_NAME;

    return isDemoSession
        ? DEMO_OPERATOR_NAME
        : LOCAL_OPERATOR_NAME;
}

function getClientOwnerName() {
    const currentConnection = connectionState.getState().currentConnection;
    const demo = monitoringState.getMonitorMode() === 'dummy'
        || currentConnection?.host === 'dummy.local'
        || currentConnection?.user === DEMO_OPERATOR_NAME;
    return demo ? DEMO_OPERATOR_NAME : LOCAL_OPERATOR_NAME;
}

function getCurrentSystemId() {
    return connectionState.getState().currentConnection?.id;
}

function getRoutingSkills(permissions: string[]) {
    const skills = ['ibmi-monitoring'];
    if (permissions.includes('investigate') || permissions.includes('execute')) {
        skills.push('incident-response', 'message-response', 'lock-investigation', 'performance', 'ibmi-operations');
    }
    if (permissions.includes('execute')) skills.push('job-control');
    return skills;
}

function getIncidentRoutingOperators(systemId: string): RoutingOperator[] {
    const grants = listSupportAccessGrants(getNormalizedSupportAccessGrants(store));
    const currentOperator = getCurrentOperatorName();
    const owner = isClientOwner(currentOperator, getClientOwnerName());
    const currentGrant = grants.find((grant) => grant.status === 'active' && grant.operatorId === currentOperator && grant.systemIds.includes(systemId));
    const operators: RoutingOperator[] = owner || currentGrant
        ? [{
            operatorId: currentOperator,
            displayName: owner ? currentOperator : currentGrant!.displayName,
            systemIds: owner ? ['*'] : currentGrant!.systemIds,
            permissions: owner ? ['read', 'investigate', 'execute'] : currentGrant!.permissions,
            skills: getRoutingSkills(owner ? ['read', 'investigate', 'execute'] : currentGrant!.permissions),
            availability: 'available',
            supportWindow: ALWAYS_ON_SUPPORT_WINDOW,
            expiresAt: currentGrant?.expiresAt
        }]
        : [];

    grants.filter((grant) => grant.status === 'active' && grant.operatorId !== currentOperator).forEach((grant) => {
        operators.push({
            operatorId: grant.operatorId,
            displayName: grant.displayName,
            systemIds: grant.systemIds,
            permissions: grant.permissions,
            skills: getRoutingSkills(grant.permissions),
            availability: 'available',
            supportWindow: ALWAYS_ON_SUPPORT_WINDOW,
            expiresAt: grant.expiresAt
        });
    });
    return operators;
}

function authorizeCurrentOperatorAction(action: ProtectedAction, systemId: string | undefined): AuthorizationResult {
    const currentSystemId = getCurrentSystemId();
    const operator = getCurrentOperatorName();
    if (!isClientOwner(operator, getClientOwnerName())) {
        return authorizeSupportAccess(
            getNormalizedSupportAccessGrants(store),
            operator,
            action,
            systemId
        );
    }

    const session = createLocalOperatorSession(operator, {
        organizationId: 'local',
        allowedSystemIds: currentSystemId ? [currentSystemId] : []
    });
    return authorizeOperatorAction(session, action, systemId);
}

function getAiAssistantSettings() {
    return toRenderableAiAssistantSettings(
        getNormalizedAiAssistantSettings(store),
        revealSecret
    );
}

function saveAiAssistantSettings(candidate: Partial<AiAssistantSettings> | undefined) {
    const merged = normalizeAiAssistantSettings({
        ...getAiAssistantSettings(),
        ...(candidate ?? {})
    });
    store.set('aiAssistantSettings', toStoredAiAssistantSettings(merged, protectSecret));
    return merged;
}

function getClickUpSettings() {
    return toRenderableClickUpSettings(
        getNormalizedStoredClickUpSettings(store, getCurrentOperatorName()),
        revealSecret
    );
}

function saveClickUpSettings(candidate: Partial<ClickUpSettings> | undefined) {
    const merged = normalizeClickUpSettings({
        ...getClickUpSettings(),
        ...(candidate ?? {})
    });

    setStoredClickUpSettingsForUser(
        store,
        getCurrentOperatorName(),
        toStoredClickUpSettings(merged, protectSecret)
    );

    return merged;
}

function getSlackSettings() {
    return toRenderableSlackSettings(
        getNormalizedStoredSlackSettings(store, getCurrentOperatorName()),
        revealSecret
    );
}

function saveSlackSettings(candidate: Partial<SlackSettings> | undefined) {
    const merged = normalizeSlackSettings({
        ...getSlackSettings(),
        ...(candidate ?? {})
    });

    setStoredSlackSettingsForUser(
        store,
        getCurrentOperatorName(),
        toStoredSlackSettings(merged, protectSecret)
    );

    return merged;
}

function getJiraSettings() {
    return toRenderableJiraSettings(
        getNormalizedStoredJiraSettings(store, getCurrentOperatorName()),
        revealSecret
    );
}

function saveJiraSettings(candidate: Partial<JiraSettings> | undefined) {
    const merged = normalizeJiraSettings({
        ...getJiraSettings(),
        ...(candidate ?? {})
    });

    setStoredJiraSettingsForUser(
        store,
        getCurrentOperatorName(),
        toStoredJiraSettings(merged, protectSecret)
    );

    return merged;
}

function getSmsSettings() {
    return toRenderableSmsNotificationSettings(
        getNormalizedStoredSmsNotificationSettings(store, getCurrentOperatorName()),
        revealSecret
    );
}

function saveSmsSettings(candidate: Partial<SmsNotificationSettings> | undefined) {
    const merged = normalizeSmsNotificationSettings({
        ...getSmsSettings(),
        ...(candidate ?? {})
    });

    setStoredSmsNotificationSettingsForUser(
        store,
        getCurrentOperatorName(),
        toStoredSmsNotificationSettings(merged, protectSecret)
    );

    return merged;
}

function protectSecret(value: string) {
    return protectPassword(value, getCredentialOptions());
}

function revealSecret(value: string) {
    try {
        return revealPassword(value, getCredentialOptions());
    } catch (error) {
        console.warn('Unable to decrypt an email notification password.', error);
        return '';
    }
}

function getEmailNotificationSettings() {
    return toRenderableEmailNotificationSettings(
        getNormalizedStoredEmailNotificationSettings(store),
        revealSecret
    );
}

function saveEmailNotificationSettings(candidate: Partial<EmailNotificationSettings> | undefined) {
    const normalized = normalizeEmailNotificationSettings(candidate);
    store.set(
        'emailNotificationSettings',
        toStoredEmailNotificationSettings(normalized, protectSecret)
    );
    return getEmailNotificationSettings();
}

function truncateForNotification(value: string, maxLength = 180) {
    if (value.length <= maxLength) {
        return value;
    }

    return `${value.slice(0, maxLength - 1)}…`;
}

let sessionRuntime!: ReturnType<typeof createSessionRuntime>;
let demoDatabase: DemoDatabase | null = null;

function getDemoDatabase() {
    if (!demoDatabase) {
        demoDatabase = new DemoDatabase(getDemoDatabasePath(app.getPath('userData')));
    }

    return demoDatabase;
}

function isDemoSession() {
    const currentConnection = connectionState.getState().currentConnection;
    return monitoringState.getMonitorMode() === 'dummy'
        || currentConnection?.host === 'dummy.local'
        || currentConnection?.user === DEMO_OPERATOR_NAME;
}

function getIncidentEvidenceCollectors() {
    if (isDemoSession()) {
        const database = getDemoDatabase();
        return {
            getJobContext: async (jobName: string) => database.getJobContext(jobName),
            getJobLog: async (jobName: string) => database.getJobLog(jobName),
            getJobMessages: async (jobName: string) => database.getJobMessages(jobName)
        };
    }

    const service = sessionRuntime.getCurrentService();
    if (!service) {
        return {
            getJobContext: async () => { throw new Error('Not connected to IBM i'); },
            getJobLog: async () => { throw new Error('Not connected to IBM i'); },
            getJobMessages: async () => { throw new Error('Not connected to IBM i'); }
        };
    }

    return {
        getJobContext: (jobName: string) => service.getJobContext(jobName),
        getJobLog: (jobName: string) => service.getJobLog(jobName),
        getJobMessages: (jobName: string) => service.getJobMessages(jobName)
    };
}

const {
    getLocalObjectAnalysisService,
    getObjectAnalysisLibraryList,
    getObjectAnalysisWorkspace,
    getObjectAnalysisSourceContent,
    analyzeObject,
    analyzeObjectWithAi,
    approveObjectAnalysis,
    saveObjectAnalysisLibraryList,
    selectObjectAnalysisDirectory,
    generateObjectAnalysisCompilePlan,
    saveObjectAnalysisReport
} = createObjectAnalysisRuntime({
    getSettings: getObjectAnalysisRuntimeSettings,
    setSettings: setObjectAnalysisRuntimeSettings,
    isDemoSession,
    isConnected: () => connectionState.getState().isConnected,
    getCurrentService: () => sessionRuntime.getCurrentService(),
    getAppPath: (name) => app.getPath(name),
    getCurrentOperatorName,
    showOpenDialog: (options) => dialog.showOpenDialog(options),
    showSaveDialog: (options) => dialog.showSaveDialog(options),
    askAssistant: (payload) => aiRuntime.askAssistant(payload),
    recordActivity: (entry) => loggingRuntime.recordActivity(entry)
});

function getRunbookPolicyForJob(jobName: string) {
    const job = monitoringState.getJob(jobName);
    if (!job) return undefined;
    const alert = alertState.getActiveAlerts().find((candidate) => candidate.jobName === jobName);
    return buildIncidentResponseSnapshot({
        job,
        alert,
        statusHistory: monitoringState.getJobStatusHistory(jobName),
        operatorName: getCurrentOperatorName(),
        systemId: getCurrentSystemId(),
        businessServiceSettings: getNormalizedBusinessServiceSettings(store)
    }).runbook;
}

type McpResourceInput = Parameters<McpResourceDependencies['getItems']>[0];

function getMcpResourceItems(request: McpResourceInput): McpResourceItem[] {
    const now = new Date().toISOString();
    const jobName = request.jobName?.trim();
    const promptResource: Record<string, string> = {
        'job-health-summary': 'ibmi://jobs/current',
        'incident-review': 'imonitor://runbooks/approved',
        'resolution-review': 'imonitor://resolution-memory/approved'
    };
    const name = request.kind === 'prompt' ? promptResource[request.name] || request.name : request.name;
    const source = (id: string, title: string, content: unknown, observedAt: string, kind: McpResourceItem['sourceRef']['kind']): McpResourceItem => ({
        id, title, content: JSON.stringify(content), observedAt, sourceRef: { kind, id, locator: `imonitor://${request.scope.systemScope}/${encodeURIComponent(id)}` }
    });

    if (name === 'ibmi://jobs/current') {
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
                }, now, 'job');
            });
    }

    if (name === 'ibmi://incidents/current') {
        return alertState.getActiveAlerts()
            .filter((alert) => !jobName || alert.jobName === jobName)
            .slice(0, 100)
            .map((alert) => {
                const evidence = Object.fromEntries(Object.entries(alert.evidence || {}).map(([key, value]) => [key, {
                    status: value.status,
                    recordCount: value.recordCount,
                    collectedAt: value.collectedAt,
                    detail: value.detail
                }]));
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
        const alerts = alertState.getActiveAlerts().filter((alert) => !jobName || alert.jobName === jobName);
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

const windowRuntime = createWindowRuntime({
    preloadPath: path.join(__dirname, 'preload.js'),
    isDevelopment: process.env.NODE_ENV === 'development',
    iconPath: resolveAppIconPath(),
    shouldShowWindow: () => !(
        app.getLoginItemSettings().wasOpenedAtLogin
        && getNormalizedCollectorSettings(store).enabled
    ),
    onClosed: () => {
        sessionRuntime.handleWindowClosed();
    }
});

app.setAsDefaultProtocolClient('imonitor');

function handleAppDeepLink(target: string) {
    try {
        const url = new URL(target);
        if (url.protocol !== 'imonitor:') {
            return;
        }

        if (url.hostname === 'open' && url.pathname === '/actionboard') {
            if (connectionState.getState().isConnected) {
                windowRuntime.loadMonitorPage();
            } else {
                windowRuntime.loadConnectionPage();
            }
            windowRuntime.getWindow()?.show();
            windowRuntime.getWindow()?.focus();
        }
    } catch {
        // Ignore malformed external URLs.
    }
}

app.on('open-url', (event, target) => {
    event.preventDefault();
    handleAppDeepLink(target);
});

const persistedIncidentLedger = getNormalizedIncidentLedger(store);
const alertState = createAlertStateStore({
    initialWorkflowStateByAlertId: store.get('alertWorkflowState') ?? {},
    initialIncidentLedger: persistedIncidentLedger,
    persistWorkflowState: (workflowStateByAlertId) => {
        store.set('alertWorkflowState', workflowStateByAlertId);
    },
    persistIncidentLedger: (incidentLedger) => {
        store.set('incidentLedger', incidentLedger);
    },
    getIncidentScope: () => {
        const connection = connectionState.getState().currentConnection;
        return connection
            ? { systemId: connection.id, systemLabel: connection.name }
            : undefined;
    },
    captureIncidentEvidence: (alert, triggerJob) => {
        const connection = connectionState.getState().currentConnection;
        return captureIncidentEvidence({
            alert,
            triggerJob,
            source: isDemoSession() ? 'demo' : 'ibmi',
            systemId: connection?.id,
            systemLabel: connection?.name,
            collectors: getIncidentEvidenceCollectors()
        });
    },
    onAlertsChanged: (alerts) => {
        windowRuntime.sendToWindow('alerts-updated', alerts);
    },
    onAlertResolved: (alert) => {
        void syncLinkedExternalWorkItem({
            alertId: alert.id,
            action: 'recovered',
            eventKey: `recovered:${alert.workflowUpdatedAt}`,
            nextState: workflowStateFromAlert(alert)
        });
    },
    onAlertCreated: async (alert) => {
        const shouldDeliverAlert = shouldWatchAlert(getAlertSettings(), alert.kind);
        if (!shouldDeliverAlert) return;

        const occurrence = alert.occurrence ?? 1;
        const slackEventKey = buildDeliveryEventKey('slack', 'incident-created', alert.id, occurrence);
        if (hasEntitlement(getEntitlements(), 'slack-integration')) {
            if (slackRuntime.canSendAlerts()) {
                const result = await deliveryRegistry.deliver(
                    'slack',
                    slackEventKey,
                    () => slackRuntime.sendAlert(alert)
                );
                if (result.state === 'failed') {
                    loggingRuntime.recordActivity({
                        area: 'monitoring',
                        level: 'warning',
                        message: 'Slack alert delivery failed after bounded retries.',
                        detail: `${alert.id}\n${result.error || 'Unknown delivery error'}`
                    });
                }
            } else {
                deliveryRegistry.skip('slack', slackEventKey, 'Slack is not configured or unavailable.');
            }
        }

        const jiraEventKey = buildDeliveryEventKey('jira', 'incident-created', alert.id);
        if (hasEntitlement(getEntitlements(), 'jira-integration')) {
            if (jiraRuntime.canSendAlerts()) {
                const result = await deliveryRegistry.deliver(
                    'jira',
                    jiraEventKey,
                    async () => {
                        const currentAlert = alertState.getActiveAlerts().find((entry) => entry.id === alert.id);
                        if (currentAlert?.jiraIssue?.key) {
                            return currentAlert.jiraIssue;
                        }
                        const issue = await jiraRuntime.sendAlert(alert);
                        alertState.mutateAlertWorkflow(alert.id, (state) => (
                            attachJiraIssueToWorkflow(state, issue, new Date().toISOString())
                        ));
                        return issue;
                    }
                );
                if (result.state === 'failed') {
                    loggingRuntime.recordActivity({
                        area: 'monitoring',
                        level: 'warning',
                        message: 'Jira incident delivery failed after bounded retries.',
                        detail: `${alert.id}\n${result.error || 'Unknown delivery error'}`
                    });
                }
            } else {
                deliveryRegistry.skip('jira', jiraEventKey, 'Jira is not configured or unavailable.');
            }
        }
    }
});

const loggingRuntime = createLoggingRuntime({
    userDataPath: app.getPath('userData'),
    getConnectionContext: () => {
        const state = connectionState.getState();
        return {
            systemId: state.currentConnection?.id ?? null,
            name: state.currentConnection?.name ?? null,
            host: state.currentConnection?.host ?? null,
            user: state.currentConnection?.user ?? null,
            port: state.currentConnection?.port ?? null
        };
    },
    getMonitorMode: () => monitoringState.getMonitorMode(),
    getMonitoringHistory: () => monitoringState.getMonitoringHistory(),
    getActiveAlertsCount: () => alertState.getActiveAlerts().length,
    encryptAtRest: (value) => {
        if (!safeStorage.isEncryptionAvailable()) {
            throw new Error('Local log encryption is unavailable.');
        }

        return safeStorage.encryptString(value).toString('base64');
    },
    getJobKey,
    toNumber: (value) => toNumber(value as string | number | null | undefined),
    maxActivityEntries: MAX_ACTIVITY_LOG_ENTRIES
});

const collectionRuntime = createCollectionRuntime(() => app.getPath('userData'));
const knowledgeStore = createKnowledgeStore(() => app.getPath('userData'));
const localKnowledgeIndex = createLocalKnowledgeIndexAdapter(knowledgeStore);
let knowledgeIndexGateway = createKnowledgeIndexGateway({
    local: localKnowledgeIndex,
    config: getNormalizedKnowledgeIndexSettings(store)
});

async function getKnowledgeIndexSettings() {
    const stored = getNormalizedKnowledgeIndexSettings(store);
    return {
        success: true,
        settings: normalizeKnowledgeIndexSettings(stored),
        catalog: getKnowledgeIndexCatalog(),
        health: await knowledgeIndexGateway.health()
    };
}

async function saveKnowledgeIndexSettings(candidate: unknown) {
    const next = normalizeKnowledgeIndexSettings(candidate);
    if (next.backend !== 'local') {
        return {
            success: false,
            settings: normalizeKnowledgeIndexSettings(getNormalizedKnowledgeIndexSettings(store)),
            error: `${next.backend} is not installed yet. Keep Local lexical index selected until an approved adapter is available.`
        };
    }

    const previous = getNormalizedKnowledgeIndexSettings(store);
    const stored = toStoredKnowledgeIndexSettings(
        candidate as Partial<KnowledgeIndexSettings> & { apiKey?: string },
        previous,
        protectSecret
    );
    store.set('knowledgeIndexSettings', stored);
    knowledgeIndexGateway = createKnowledgeIndexGateway({ local: localKnowledgeIndex, config: stored });
    return getKnowledgeIndexSettings();
}

function getKnowledgeAccessContext(): KnowledgeAccessContext {
    const operatorId = getCurrentOperatorName();
    const systemScope = getCurrentSystemId() || '';
    const owner = isClientOwner(operatorId, getClientOwnerName());
    const grant = owner
        ? undefined
        : getEffectiveSupportAccessGrant(getNormalizedSupportAccessGrants(store), operatorId, systemScope);
    return {
        customerScope: owner ? 'local' : grant?.organizationId || '',
        systemScope,
        operatorId,
        operatorPermissions: owner ? ['read', 'investigate', 'execute'] : grant?.permissions || [],
        identity: owner ? 'local-owner' : 'delegated',
        grant: grant ? toKnowledgeGrantSnapshot(grant) : undefined
    };
}

const widgetSummaryRuntime = createWidgetSummaryRuntime({
    userDataPath: app.getPath('userData'),
    appGroupIdentifier: 'group.com.inewtech.imonitor',
    getConnectionContext: () => {
        const state = connectionState.getState();
        return {
            name: state.currentConnection?.name ?? null,
            host: state.currentConnection?.host ?? null,
            user: state.currentConnection?.user ?? null,
            port: state.currentConnection?.port ?? null
        };
    },
    isMonitoringActive: () => monitoringState.getMonitoringState().active
});

const clickUpRuntime = createClickUpRuntime({
    getSettings: getClickUpSettings,
    saveSettings: (settings) => saveClickUpSettings(settings),
    getOperatorName: getCurrentOperatorName,
    getJobReadableLogFilePath: (jobName) => loggingRuntime.getJobReadableLogFilePath(jobName),
    recordActivity: loggingRuntime.recordActivity
});

async function ensureClickUpTaskForAlert(alertId: string) {
    if (!hasEntitlement(getEntitlements(), 'clickup-integration')) {
        loggingRuntime.recordActivity({
            area: 'monitoring',
            level: 'info',
            message: 'ClickUp task creation skipped: Premium is not active.',
            detail: alertId
        });
        return;
    }
    const alert = alertState.getActiveAlerts().find((entry) => entry.id === alertId);
    if (!alert || alert.clickUpTask?.id) {
        return;
    }

    if (!clickUpRuntime.canAutoCreateTasks()) {
        loggingRuntime.recordActivity({
            area: 'monitoring',
            level: 'info',
            message: 'Alert work has no linked ClickUp task.',
            detail: 'Configure ClickUp and select a target list to create a linked task when work starts or a handoff is accepted.'
        });
        return;
    }

    try {
        const eventKey = buildDeliveryEventKey(
            'clickup',
            'incident-task-created',
            alert.id,
            alert.occurrence ?? 1
        );
        const result = await deliveryRegistry.deliver('clickup', eventKey, async () => {
            const task = await clickUpRuntime.createTaskForAlert(alert, { assignToOperator: true });
            alertState.mutateAlertWorkflow(alertId, (state) => (
                attachClickUpTaskToWorkflow(state, task, new Date().toISOString())
            ));
            return task;
        });
        if (result.state !== 'sent') {
            if (result.state === 'failed') {
                loggingRuntime.recordActivity({
                    area: 'monitoring',
                    level: 'warning',
                    message: 'ClickUp task creation failed after bounded retries.',
                    detail: `${alertId}\n${result.error || 'Unknown delivery error'}`
                });
            }
            return;
        }
        const task = result.value;
        if (!task) return;

        let diagnostic = '';
        try {
            const diagnosticResult = await aiRuntime.analyzeAlert(alert);
            diagnostic = diagnosticResult.success && diagnosticResult.reply
                ? diagnosticResult.reply
                : buildFallbackAlertDiagnostic(
                    alert,
                    diagnosticResult.error || diagnosticResult.availability?.message || 'No AI response was returned.'
                );
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            diagnostic = buildFallbackAlertDiagnostic(alert, message);
        }

        await clickUpRuntime.publishAlertDiagnostic({
            alertId,
            taskId: task.id,
            diagnostic,
            jobName: alert.jobName
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        loggingRuntime.recordActivity({
            area: 'monitoring',
            level: 'warning',
            message: 'ClickUp task creation failed when work started.',
            detail: `${alertId}\n${message}`
        });
    }
}

const slackRuntime = createSlackRuntime({
    getSettings: getSlackSettings,
    getOperatorName: getCurrentOperatorName,
    recordActivity: loggingRuntime.recordActivity
});

const jiraRuntime = createJiraRuntime({
    getSettings: getJiraSettings,
    getOperatorName: getCurrentOperatorName,
    recordActivity: loggingRuntime.recordActivity
});

async function ensureJiraIssueForAlert(alertId: string) {
    if (!hasEntitlement(getEntitlements(), 'jira-integration')) return;
    const alert = alertState.getActiveAlerts().find((entry) => entry.id === alertId);
    if (!alert || alert.jiraIssue?.key || !jiraRuntime.canSendAlerts()) return;

    const eventKey = buildDeliveryEventKey(
        'jira',
        'incident-created',
        alert.id,
        alert.occurrence ?? 1
    );
    const result = await deliveryRegistry.deliver('jira', eventKey, async () => {
        const issue = await jiraRuntime.sendAlert(alert);
        alertState.mutateAlertWorkflow(alertId, (state) => (
            attachJiraIssueToWorkflow(state, issue, new Date().toISOString())
        ));
        return issue;
    });
    if (result.state === 'failed') {
        loggingRuntime.recordActivity({
            area: 'monitoring',
            level: 'warning',
            message: 'Jira handoff issue creation failed after bounded retries.',
            detail: `${alertId}\n${result.error || 'Unknown delivery error'}`
        });
    }
}

type ExternalWorkflowSyncPayload = {
    alertId: string;
    action: 'acknowledge' | 'claim' | 'release' | 'workDone' | 'note' | 'handoff' | 'recovered';
    eventKey?: string;
    note?: string;
    nextState: StoredAlertWorkflowState;
};

function workflowStateFromAlert(alert: MonitorAlert): StoredAlertWorkflowState {
    return {
        status: alert.workflowStatus,
        owner: alert.owner,
        notes: alert.notes,
        timeline: alert.timeline,
        updatedAt: alert.workflowUpdatedAt,
        lastActionSummary: alert.lastActionSummary,
        clickUpTask: alert.clickUpTask,
        jiraIssue: alert.jiraIssue,
        handoff: alert.handoff
    };
}

/** Sends the same approved workflow event to each configured external adapter. */
async function syncLinkedExternalWorkItem(payload: ExternalWorkflowSyncPayload) {
    const eventSuffix = payload.eventKey || `${payload.action}:${payload.nextState.updatedAt}`;
    const clickUpSettings = getClickUpSettings();
    const isHandoffUpdate = payload.action === 'handoff';
    if (clickUpSettings.enabled
        && payload.nextState.clickUpTask?.id
        && (clickUpSettings.syncComments || isHandoffUpdate)) {
        const clickUpEventKey = buildDeliveryEventKey('clickup', 'workflow-update', payload.alertId, eventSuffix);
        const result = await deliveryRegistry.deliver('clickup', clickUpEventKey, async () => {
            const delivery = await clickUpRuntime.syncAlertWorkflowComment(payload);
            if (!delivery.success && !delivery.skipped) {
                throw new Error(delivery.error || 'ClickUp workflow update failed.');
            }
            return delivery;
        });
        if (result.state === 'failed') {
            loggingRuntime.recordActivity({
                area: 'monitoring',
                level: 'warning',
                message: 'ClickUp workflow update failed after bounded retries.',
                detail: `${payload.alertId}\n${result.error || 'Unknown delivery error'}`
            });
        }
    }

    const jiraSettings = getJiraSettings();
    if (jiraSettings.enabled && payload.nextState.jiraIssue?.key && jiraRuntime.canSendAlerts()) {
        const jiraEventKey = buildDeliveryEventKey('jira', 'workflow-update', payload.alertId, eventSuffix);
        const result = await deliveryRegistry.deliver('jira', jiraEventKey, () => (
            jiraRuntime.syncAlertWorkflowComment({
                issueKey: payload.nextState.jiraIssue!.key,
                alertId: payload.alertId,
                action: payload.action,
                nextState: payload.nextState,
                note: payload.note
            })
        ));
        if (result.state === 'failed') {
            loggingRuntime.recordActivity({
                area: 'monitoring',
                level: 'warning',
                message: 'Jira workflow update failed after bounded retries.',
                detail: `${payload.alertId}\n${result.error || 'Unknown delivery error'}`
            });
        }
    }
}

async function notifyIncidentHandoff(params: {
    alert: MonitorAlert;
    handoff: IncidentHandoff;
    event: 'requested' | 'accepted';
}) {
    if (!hasEntitlement(getEntitlements(), 'slack-integration') || !slackRuntime.canSendAlerts()) return;

    const eventKey = buildDeliveryEventKey(
        'slack',
        'incident-handoff',
        params.alert.id,
        `${params.handoff.id}:${params.event}`
    );
    const result = await deliveryRegistry.deliver('slack', eventKey, () => (
        slackRuntime.sendHandoffNotification({
            alertId: params.alert.id,
            title: params.alert.title,
            jobName: params.alert.jobName,
            fromOperator: params.handoff.fromOperator,
            toOperator: params.handoff.toOperator,
            reason: params.handoff.reason,
            pendingChecks: params.handoff.pendingChecks,
            responseTargetAt: params.handoff.responseTargetAt,
            event: params.event
        })
    ));
    if (result.state === 'failed') {
        loggingRuntime.recordActivity({
            area: 'monitoring',
            level: 'warning',
            message: 'Slack handoff notification failed after bounded retries.',
            detail: `${params.alert.id}\n${result.error || 'Unknown delivery error'}`
        });
    }
}

const emailNotificationRuntime = createEmailNotificationRuntime({
    appName: 'iMonitor',
    cooldownMs: NOTIFICATION_COOLDOWN_MS,
    getSettings: getEmailNotificationSettings,
    getConnectionLabel: () => {
        const currentConnection = connectionState.getState().currentConnection;
        if (!currentConnection) {
            return 'No active connection';
        }

        return `${currentConnection.name} (${currentConnection.user}@${currentConnection.host}:${currentConnection.port})`;
    },
    recordActivity: loggingRuntime.recordActivity
});

const smsNotificationRuntime = createSmsNotificationRuntime({
    getSettings: getSmsSettings,
    getConnectionLabel: () => {
        const currentConnection = connectionState.getState().currentConnection;
        if (!currentConnection) {
            return 'No active connection';
        }

        return `${currentConnection.name} (${currentConnection.user}@${currentConnection.host}:${currentConnection.port})`;
    },
    getOperatorName: getCurrentOperatorName,
    cooldownMs: NOTIFICATION_COOLDOWN_MS,
    development: developmentBuild,
    recordActivity: loggingRuntime.recordActivity
});

const supportRuntime = createSupportRuntime({
    appName: 'iMonitor',
    appVersion: app.getVersion(),
    supportEmail: SUPPORT_EMAIL,
    downloadsPath: app.getPath('downloads'),
    openExternal: (target) => shell.openExternal(target),
    showItemInFolder: shell.showItemInFolder,
    recordActivity: loggingRuntime.recordActivity,
    encryptDiagnostics: (value) => encryptDiagnostics(value, SUPPORT_DIAGNOSTICS_PUBLIC_KEY),
    getDeveloperLogText: () => loggingRuntime.getDeveloperLogText()
});

const aiRuntime = createAiRuntime({
    appName: 'iMonitor',
    getSettings: getAiAssistantSettings,
    getConnection: () => connectionState.getState().currentConnection,
    getMonitorMode: () => monitoringState.getMonitorMode(),
    getLatestJobs: () => monitoringState.getLatestJobs(),
    getJob: (jobName) => monitoringState.getJob(jobName),
    getActiveAlerts: () => alertState.getActiveAlerts(),
    getMonitoringHistory: () => monitoringState.getMonitoringHistory(),
    getJobStatusHistory: (jobName) => monitoringState.getJobStatusHistory(jobName),
    getActivityLog: () => loggingRuntime.getActivityLog(),
    getHighCpuThreshold: () => getAlertSettings().highCpuThreshold,
    getCurrentSystemId,
    getResolutionMemory: () => getNormalizedResolutionMemory(store),
    getKnowledgeAccessContext,
    getKnowledgeIndexGateway: () => knowledgeIndexGateway,
    recordActivity: loggingRuntime.recordActivity
});

function emitAlertSettings() {
    windowRuntime.sendToWindow('alert-settings-updated', getAlertSettings());
}

function emitDeploymentStatus(status: { level: 'info' | 'success' | 'warning' | 'error'; message: string; detail?: string; }) {
    windowRuntime.sendToWindow('deployment-status', status);
    loggingRuntime.recordActivity({
        area: 'connection',
        level: status.level === 'warning' ? 'warning' : status.level === 'error' ? 'error' : 'info',
        message: `Mapepire deploy: ${status.message}`,
        detail: status.detail
    });
}

function emitConnectionAction(message: string, detail?: string) {
    windowRuntime.sendToWindow('connection-action-status', {
        message,
        detail
    });
}

function maybeShowNotification(key: string, title: string, body: string) {
    const settings = getAlertSettings();
    if (!settings.desktopNotifications || !Notification.isSupported()) {
        return;
    }

    const previousTimestamp = alertState.getNotificationLedger().get(key) ?? 0;
    const now = Date.now();
    if (now - previousTimestamp < NOTIFICATION_COOLDOWN_MS) {
        return;
    }

    alertState.getNotificationLedger().set(key, now);
    try {
        const notification = new Notification(resolveNotificationOptions(title, body));
        notification.show();
    } catch (error) {
        console.warn('Unable to show desktop notification.', error);
    }
}

async function notifyOperators(key: string, title: string, body: string) {
    maybeShowNotification(key, title, body);

    try {
        await emailNotificationRuntime.sendAlertEmail({
            key,
            title,
            body
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        loggingRuntime.recordActivity({
            area: 'connection',
            level: 'error',
            message: 'Email alert delivery failed.',
            detail: `${title}\n${message}`
        });
    }

    if (hasEntitlement(getEntitlements(), 'sms-notifications')) {
        try {
            await smsNotificationRuntime.sendAlert({
                key,
                title,
                body
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            loggingRuntime.recordActivity({
                area: 'connection',
                level: 'error',
                message: 'SMS alert delivery failed.',
                detail: `${title}\n${message}`
            });
        }
    }
}

async function readJobQueues(options: JobQueueQuery): Promise<PagedResult<JobQueueRecord>> {
    const result = monitoringState.getMonitorMode() === 'live'
        ? await (() => {
            const service = sessionRuntime.getCurrentService();
            if (!service) throw new Error('Not connected to IBM i');
            return service.getJobQueues(options);
        })()
        : getDemoDatabase().getJobQueues(options);
    return { ...result, data: result.data.map((record) => normalizeJobQueueRecord(record as unknown as Record<string, unknown>)) };
}

async function readJobQueueDetails(queueName: string, queueLibrary: string) {
    if (monitoringState.getMonitorMode() === 'live') {
        const service = sessionRuntime.getCurrentService();
        if (!service) throw new Error('Not connected to IBM i');
        const queue = await service.getJobQueueDetails(queueName, queueLibrary);
        const subsystemName = String(queue?.SUBSYSTEM_NAME || '').trim();
        const subsystemLibrary = String(queue?.SUBSYSTEM_LIBRARY_NAME || 'QSYS').trim() || 'QSYS';
        return { queue, subsystem: subsystemName ? await service.getSubsystemDetails(subsystemName, subsystemLibrary) : null };
    }
    const database = getDemoDatabase();
    const queue = database.getJobQueueDetails(queueName, queueLibrary);
    const subsystemName = String(queue?.SUBSYSTEM_NAME || '').trim();
    const subsystemLibrary = String(queue?.SUBSYSTEM_LIBRARY_NAME || 'QSYS').trim() || 'QSYS';
    return { queue, subsystem: subsystemName ? database.getSubsystemDetails(subsystemName, subsystemLibrary) : null };
}

async function readQueuedJobs(options: QueuedJobQuery): Promise<PagedResult<QueuedJobRecord>> {
    const result = monitoringState.getMonitorMode() === 'live'
        ? await (() => {
            const service = sessionRuntime.getCurrentService();
            if (!service) throw new Error('Not connected to IBM i');
            return service.getQueuedJobs(options);
        })()
        : getDemoDatabase().getQueuedJobs(options);
    return { ...result, data: result.data.map((record) => normalizeQueuedJobRecord(record as unknown as Record<string, unknown>)) };
}

async function verifyJobQueueAction(payload: {
    kind: JobQueueActionKind;
    queueName: string;
    queueLibrary: string;
    jobName?: string;
}): Promise<RecoveryVerificationResult> {
    const observedAt = new Date().toISOString();
    try {
        const [queuePage, details, jobs] = await Promise.all([
            readJobQueues({ search: payload.queueName, status: 'ALL', limit: 10 }),
            readJobQueueDetails(payload.queueName, payload.queueLibrary),
            readQueuedJobs(payload.jobName
                ? { search: payload.jobName, status: 'ALL', limit: 10 }
                : { queueName: payload.queueName, queueLibrary: payload.queueLibrary, status: 'ALL', limit: 100 })
        ]);
        const queue = queuePage.data.find((candidate) => candidate.JOB_QUEUE_NAME === payload.queueName
            && candidate.JOB_QUEUE_LIBRARY === payload.queueLibrary) || null;
        const queuedJob = payload.jobName
            ? jobs.data.find((candidate) => candidate.JOB_NAME === payload.jobName) || null
            : null;
        const verifiedQueue = queue || (details.queue ? normalizeJobQueueRecord(details.queue) : null);
        return buildQueueRecoveryVerification(
            payload,
            verifiedQueue,
            queuedJob,
            Number(verifiedQueue?.WAITING_JOBS || jobs.data.length),
            observedAt
        );
    } catch (error) {
        return {
            status: 'unknown',
            summary: 'The action was submitted, but recovery could not be verified.',
            observedAt,
            evidence: [error instanceof Error ? error.message : 'Verification read failed.']
        };
    }
}

const queueTriageRuntime = createQueueTriageRuntime({
    initialResults: getNormalizedQueueTriageResults(store),
    getJobQueues: readJobQueues,
    getQueuedJobs: readQueuedJobs,
    getJobQueueDetails: readJobQueueDetails,
    persistResults: (results) => store.set('queueTriageResults', results),
    sendToWindow: windowRuntime.sendToWindow,
    recordActivity: loggingRuntime.recordActivity
});

const monitoringRuntime = createMonitoringRuntime({
    getCurrentService: () => sessionRuntime.getCurrentService(),
    getDemoDatabase,
    getAlertSettings,
    monitoringState,
    alertState,
    recordActivity: loggingRuntime.recordActivity,
    sendToWindow: windowRuntime.sendToWindow,
    notify: notifyOperators,
    persistPoll: loggingRuntime.persistPoll,
    persistCollection: (jobs, timestamp, intervalMs) => {
        const state = connectionState.getState();
        const connection = state.currentConnection;
        if (!connection) return;
        return collectionRuntime.appendPoll(jobs, timestamp, intervalMs, {
            systemId: connection.id,
            systemLabel: connection.name,
            host: connection.host,
            user: connection.user,
            mode: monitoringState.getMonitorMode()
        }).then(async () => {
            await collectionRuntime.enforceRetention(getNormalizedCollectorSettings(store));
        });
    },
    persistWidgetSummary: (jobs, timestamp) => {
        widgetSummaryRuntime.writeSummary(jobs, alertState.getActiveAlerts(), timestamp).catch((error) => {
            loggingRuntime.recordActivity({
                area: 'monitoring',
                level: 'warning',
                message: 'macOS widget summary update failed.',
                detail: error instanceof Error ? error.message : String(error)
            });
        });
    },
    runReadOnlyQueueTriage: () => queueTriageRuntime.runForHeldQueues()
});

sessionRuntime = createSessionRuntime({
    store,
    connectionState,
    monitoringState,
    clearRuntimeMonitoringState: monitoringRuntime.clearRuntimeMonitoringState,
    loadConnectionPage: windowRuntime.loadConnectionPage,
    sendToWindow: windowRuntime.sendToWindow,
    emitConnectionAction,
    emitDeploymentStatus,
    getThemeId,
    getCredentialOptions,
    recordActivity: loggingRuntime.recordActivity,
    createIbmiService: (onLogEntry) => new Db(onLogEntry),
    onServiceLogEntry: (entry: ServiceLogEntry) => {
        loggingRuntime.recordActivity(entry);
    },
    shouldKeepSessionAlive: () => getNormalizedCollectorSettings(store).enabled,
    notifyDisconnect: async () => {
        if (!getAlertSettings().watchDisconnects) {
            return;
        }

        maybeShowNotification(
            'disconnect',
            'iMonitor disconnected',
            'The active IBM i session was disconnected.'
        );

        try {
            await emailNotificationRuntime.sendDisconnectEmail();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            loggingRuntime.recordActivity({
                area: 'connection',
                level: 'error',
                message: 'Disconnect email delivery failed.',
                detail: message
            });
        }

        if (hasEntitlement(getEntitlements(), 'sms-notifications')) {
            try {
                await smsNotificationRuntime.sendDisconnectSms();
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                loggingRuntime.recordActivity({
                    area: 'connection',
                    level: 'error',
                    message: 'SMS disconnect notification failed.',
                    detail: message
                });
            }
        }
    }
});

const backgroundCollectorRuntime = createBackgroundCollectorRuntime({
    getSettings: () => getNormalizedCollectorSettings(store),
    saveSettings: (settings: CollectorSettings) => store.set('collectorSettings', settings),
    getConnectionId: () => getCurrentSystemId(),
    connectSavedConnection: (id) => sessionRuntime.connectSavedConnection(id),
    startMonitoring: (intervalMs) => monitoringRuntime.startMonitoring(intervalMs),
    stopMonitoring: (recordStop) => monitoringRuntime.stopMonitoring(recordStop),
    isMonitoringActive: () => monitoringState.getMonitoringState().active,
    setLoginItemSettings: (enabled) => app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: true }),
    collectionRuntime,
    recordActivity: loggingRuntime.recordActivity,
    sendToWindow: windowRuntime.sendToWindow
});

registerConnectionIpc({
    getConnectionState: () => sessionRuntime.getConnectionState(),
    getMonitoringState: () => sessionRuntime.getMonitoringState(),
    getAppFlags: () => sessionRuntime.getAppFlags(),
    getThemeSettings: () => sessionRuntime.getThemeSettings(),
    saveThemeSettings: (themeId) => sessionRuntime.saveThemeSettings(themeId),
    saveConnection: (connection) => sessionRuntime.saveConnection(connection),
    loadConnections: () => sessionRuntime.loadConnections(),
    deleteConnection: (id) => sessionRuntime.deleteConnection(id),
    deployMapepire: (payload) => sessionRuntime.deployMapepire(payload),
    connectToSystem: (config) => sessionRuntime.connectToSystem(config),
    getSystemStatus: () => monitoringRuntime.getSystemStatus(),
    disconnect: () => sessionRuntime.disconnect()
});

registerCollectorIpc({
    getSettings: () => getNormalizedCollectorSettings(store),
    applySettings: (settings) => backgroundCollectorRuntime.applySettings(settings),
    getStatus: backgroundCollectorRuntime.getStatus,
    collectionRuntime
});

registerKnowledgeIpc({
    getStore: () => knowledgeStore,
    getIndexGateway: () => knowledgeIndexGateway,
    getAccessContext: getKnowledgeAccessContext,
    recordActivity: loggingRuntime.recordActivity
});

registerKnowledgeIndexIpc({
    getSettings: getKnowledgeIndexSettings,
    saveSettings: saveKnowledgeIndexSettings,
    testConnection: () => knowledgeIndexGateway.health()
});

registerMcpIpc({
    getRegistry: () => getNormalizedMcpRegistry(store),
    saveRegistry: (candidate) => saveMcpRegistry(store, candidate),
    getAccessContext: getKnowledgeAccessContext,
    getResourceItems: getMcpResourceItems,
    recordActivity: loggingRuntime.recordActivity
});

registerNavigationIpc({
    canOpenMonitor: () => connectionState.getState().isConnected,
    loadMonitorPage: windowRuntime.loadMonitorPage,
    loadConnectionPage: windowRuntime.loadConnectionPage,
    loadSettingsPage: windowRuntime.loadSettingsPage,
    loadKnowledgePage: windowRuntime.loadKnowledgePage,
    loadObjectAnalysisPage: windowRuntime.loadObjectAnalysisPage,
    openJobTaskWindow: windowRuntime.openJobTaskWindow,
    openExternalUrl: (target) => shell.openExternal(target),
    recordActivity: loggingRuntime.recordActivity
});

registerObjectAnalysisIpc({
    getSettings: () => getObjectAnalysisRuntimeSettings(),
    saveSettings: (candidate) => setObjectAnalysisRuntimeSettings(candidate),
    selectLocalDirectory: selectObjectAnalysisDirectory,
    getLibraryList: getObjectAnalysisLibraryList,
    saveLibraryList: saveObjectAnalysisLibraryList,
    getWorkspace: getObjectAnalysisWorkspace,
    loadSource: getObjectAnalysisSourceContent,
    analyzeObject,
    analyzeWithAi: analyzeObjectWithAi,
    approveAnalysis: approveObjectAnalysis,
    saveReport: saveObjectAnalysisReport,
    generateCompilePlan: generateObjectAnalysisCompilePlan,
    recordActivity: loggingRuntime.recordActivity
});

registerLogsIpc({
    getMonitoringHistory: () => monitoringState.getMonitoringHistory().slice()
});

registerSupportMetricsIpc({
    getSystemId: getCurrentSystemId,
    getIncidents: () => Object.values(alertState.getIncidentLedger()),
    getActivityLog: () => loggingRuntime.getActivityLog(),
    authorizeRead: () => authorizeCurrentOperatorAction('read', getCurrentSystemId()),
    getDownloadsPath: () => app.getPath('downloads'),
    showSaveDialog: (options) => dialog.showSaveDialog(options),
    recordActivity: loggingRuntime.recordActivity
});

registerSupportIpc({
    getAppInfo: () => supportRuntime.getAppInfo(),
    contactSupport: () => supportRuntime.contactSupport(),
    sendSupportDiagnostics: () => supportRuntime.sendSupportDiagnostics()
});

registerSupportAccessIpc({
    getGrants: () => getNormalizedSupportAccessGrants(store),
    saveGrants: (grants) => store.set('supportAccessGrants', grants),
    getCurrentOperatorName,
    getClientOwnerName,
    recordActivity: loggingRuntime.recordActivity
});

registerEntitlementsIpc({
    getEntitlements,
    activateDevelopmentLicense: (key) => {
        if (developmentBuild && key === expectedDevelopmentLicenseKey) {
            activatedDevelopmentLicenseKey = key;
            selectedDevelopmentPlan = 'premium';
            store.set('developmentPlan', 'premium');
        } else {
            activatedDevelopmentLicenseKey = '';
        }
        return getEntitlements();
    },
    setDevelopmentPlan: (plan) => {
        if (developmentBuild) {
            selectedDevelopmentPlan = plan;
            store.set('developmentPlan', plan);
            if (plan === 'free') {
                activatedDevelopmentLicenseKey = '';
            }
        }
        return getEntitlements();
    }
});

registerAiIpc({
    requireProviderAccess: (provider) => {
        const activeProvider = provider || getAiAssistantSettings().provider;
        if (activeProvider !== 'ollama') {
            requireEntitlement('hosted-ai-providers');
        }
    },
    getAiProviderCatalog,
    getAiSettings: getAiAssistantSettings,
    saveAiSettings: (settings) => saveAiAssistantSettings(settings),
    getAiAvailability: () => aiRuntime.getAiAvailability(),
    askAssistant: (payload) => aiRuntime.askAssistant(payload),
    authorizeAction: (action, systemId) => authorizeCurrentOperatorAction(action, systemId),
    getCurrentSystemId
});

registerClickUpIpc({
    requirePremium: () => requireEntitlement('clickup-integration'),
    getClickUpSettings,
    saveClickUpSettings: (settings) => saveClickUpSettings(settings),
    loadClickUpTargetOptions: () => clickUpRuntime.loadTargetOptions(),
    resolveConfiguredAssignee: () => clickUpRuntime.resolveConfiguredAssignee(),
    getAlertById: (alertId) => alertState.getActiveAlerts().find((alert) => alert.id === alertId),
    mutateAlertWorkflow: (alertId, mutation) => alertState.mutateAlertWorkflow(alertId, mutation),
    attachClickUpTaskToWorkflow,
    createTaskForAlert: (alert) => clickUpRuntime.createTaskForAlert(alert)
});

registerSlackIpc({
    requirePremium: () => requireEntitlement('slack-integration'),
    getSlackSettings,
    saveSlackSettings: (settings) => saveSlackSettings(settings),
    sendTestSlackMessage: async () => {
        try {
            await slackRuntime.sendTestMessage();
            return { success: true };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            loggingRuntime.recordActivity({
                area: 'connection',
                level: 'error',
                message: 'Test Slack delivery failed.',
                detail: message
            });
            return {
                success: false,
                error: message
            };
        }
    }
});

registerJiraIpc({
    requirePremium: () => requireEntitlement('jira-integration'),
    getJiraSettings,
    saveJiraSettings: (settings) => saveJiraSettings(settings),
    sendTestJiraMessage: async () => jiraRuntime.sendTestMessage()
});

registerSmsIpc({
    requirePremium: () => requireEntitlement('sms-notifications'),
    getSmsSettings,
    saveSmsSettings: (settings) => saveSmsSettings(settings),
    sendTestSms: async () => {
        try {
            return await smsNotificationRuntime.sendTestSms();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            loggingRuntime.recordActivity({
                area: 'connection',
                level: 'error',
                message: 'Test SMS delivery failed.',
                detail: message
            });
            return { success: false, error: message };
        }
    }
});

registerAlertsIpc({
    getActiveAlerts: () => alertState.getActiveAlerts().slice(),
    getAlertById: (alertId) => alertState.getActiveAlerts().find((alert) => alert.id === alertId),
    recheckAlert: (alertId) => monitoringRuntime.recheckAlert(alertId),
    getSystemMessages: async () => {
        const service = sessionRuntime.getCurrentService();
        if (monitoringState.getMonitorMode() === 'live') {
            if (!service) {
                throw new Error('Not connected to IBM i');
            }
            return service.getSystemMessages();
        }

        return getDemoDatabase().getSystemMessages();
    },
    getAlertSettings,
    getBusinessServiceSettings: () => getNormalizedBusinessServiceSettings(store),
    saveBusinessServiceSettings: (settings) => saveBusinessServiceSettings(store, settings),
    setAlertSettings: (settings) => {
        store.set('alertSettings', settings);
    },
    emitAlertSettings,
    getEmailNotificationSettings,
    saveEmailNotificationSettings,
    sendTestEmailNotification: async () => {
        try {
            await emailNotificationRuntime.sendTestEmail();
            return { success: true };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            loggingRuntime.recordActivity({
                area: 'connection',
                level: 'error',
                message: 'Test email delivery failed.',
                detail: message
            });
            return {
                success: false,
                error: message
            };
        }
    },
    mutateAlertWorkflow: (alertId, mutation) => alertState.mutateAlertWorkflow(alertId, mutation),
    acknowledgeAlertWorkflow,
    claimAlertWorkflow,
    releaseAlertWorkflow,
    markAlertWorkDone,
    addAlertWorkflowNote,
    normalizeAlertSettings,
    getOperatorName: getCurrentOperatorName,
    authorizeAction: authorizeCurrentOperatorAction,
    getCurrentSystemId,
    syncLinkedExternalWorkItem,
    assignClickUpTaskToOperator: (taskId, operatorName, previousOperatorName) => (
        clickUpRuntime.assignClickUpTaskToOperator(taskId, operatorName, previousOperatorName)
    ),
    ensureClickUpTaskForAlert,
    ensureJiraIssueForAlert,
    notifyIncidentHandoff,
    recordActivity: loggingRuntime.recordActivity,
    onSettingsSaved: () => {
        const latestJobs = monitoringState.getLatestJobs();
        if (latestJobs.length) {
            alertState.evaluateAlertRules(
                latestJobs,
                new Date().toISOString(),
                getAlertSettings(),
                notifyOperators
            );
        }
    }
});

registerJobsIpc({
    requirePremium: () => requireEntitlement('job-actions'),
    getJob: (jobName) => monitoringState.getJob(jobName),
    getJobStatusHistory: (jobName) => monitoringState.getJobStatusHistory(jobName),
    getIncidentResponse: (jobName) => {
        const job = monitoringState.getJob(jobName);
        if (!job) return null;
        const alert = alertState.getActiveAlerts().find((candidate) => candidate.jobName === jobName);
        const systemId = getCurrentSystemId();
        const routing = alert && systemId
            ? buildRoutingRecommendation({
                alert,
                systemId,
                now: new Date().toISOString(),
                operators: getIncidentRoutingOperators(systemId),
                preferredOperatorId: getCurrentOperatorName()
            })
            : undefined;
        return buildIncidentResponseSnapshot({
            job,
            alert,
            statusHistory: monitoringState.getJobStatusHistory(jobName),
            operatorName: getCurrentOperatorName(),
            systemId,
            businessServiceSettings: getNormalizedBusinessServiceSettings(store),
            routing
        });
    },
    getJobResourceGraph: async (jobName) => {
        const job = monitoringState.getJob(jobName);
        if (!job) throw new Error('The selected job is no longer available.');
        const context = monitoringState.getMonitorMode() === 'live'
            ? await (() => {
                const service = sessionRuntime.getCurrentService();
                if (!service) throw new Error('Not connected to IBM i');
                return service.getJobContext(jobName);
            })()
            : getDemoDatabase().getJobContext(jobName);
        const alert = alertState.getActiveAlerts().find((candidate) => candidate.jobName === jobName);
        const observedAt = new Date().toISOString();
        return buildResourceGraph({ job, alert, context, observedAt, now: observedAt });
    },
    getJobContext: async (jobName) => {
        if (monitoringState.getMonitorMode() === 'live') {
            const service = sessionRuntime.getCurrentService();
            if (!service) {
                throw new Error('Not connected to IBM i');
            }
            return service.getJobContext(jobName);
        }
        return getDemoDatabase().getJobContext(jobName);
    },
    getJobLog: async (jobName) => {
        if (monitoringState.getMonitorMode() === 'live') {
            const service = sessionRuntime.getCurrentService();
            if (!service) {
                throw new Error('Not connected to IBM i');
            }
            return service.getJobLog(jobName);
        }

        return getDemoDatabase().getJobLog(jobName);
    },
    getJobMessages: async (jobName) => {
        if (monitoringState.getMonitorMode() === 'live') {
            const service = sessionRuntime.getCurrentService();
            if (!service) {
                throw new Error('Not connected to IBM i');
            }
            return service.getJobMessages(jobName);
        }

        return getDemoDatabase().getJobMessages(jobName);
    },
    getRunbook: getRunbookPolicyForJob,
    getJobQueues: readJobQueues,
    getJobQueueDetails: readJobQueueDetails,
    getQueuedJobs: readQueuedJobs,
    getQueueTriage: () => queueTriageRuntime.getResults(),
    verifyJobQueueAction,
    isQueuedJob: async (jobName: string) => {
        if (monitoringState.getMonitorMode() !== 'live') {
            return getDemoDatabase().hasQueuedJob(jobName);
        }

        const service = sessionRuntime.getCurrentService();
        if (!service) {
            throw new Error('Not connected to IBM i');
        }
        const result = await service.getQueuedJobs({ search: jobName, limit: 10 });
        return result.data.some((record) => normalizeQueuedJobRecord(record).JOB_NAME === jobName);
    },
    runJobQueueCommand: async (
        command: string,
        payload: { kind: JobQueueActionKind; queueName: string; queueLibrary: string; jobName?: string },
        live: boolean
    ) => {
        if (!live) {
            const demoDatabase = getDemoDatabase();
            if (payload.kind === 'holdQueue' || payload.kind === 'releaseQueue') {
                demoDatabase.setJobQueueStatus(
                    payload.queueName,
                    payload.queueLibrary,
                    payload.kind === 'holdQueue' ? 'HELD' : 'RELEASED'
                );
            } else if (payload.jobName) {
                demoDatabase.setQueuedJobStatus(
                    payload.jobName,
                    payload.kind === 'holdQueuedJob' ? 'HELD' : 'JOBQ'
                );
            }
            loggingRuntime.recordActivity({
                area: 'monitoring',
                level: 'success',
                message: `Simulated job queue action: ${payload.kind}.`,
                detail: `${DEMO_OPERATOR_NAME} | ${payload.jobName || `${payload.queueLibrary}/${payload.queueName}`} | ${command}`
            });
            return;
        }

        const service = sessionRuntime.getCurrentService();
        if (!service) {
            throw new Error('Not connected to IBM i');
        }

        await service.executeClCommand(command);
        loggingRuntime.recordActivity({
            area: 'monitoring',
            level: 'success',
            message: `Job queue action completed: ${payload.kind}.`,
            detail: `${LOCAL_OPERATOR_NAME} | ${payload.jobName || `${payload.queueLibrary}/${payload.queueName}`} | ${command}`
        });
        await monitoringRuntime.publishSystemStatus();
    },
    buildWaitReason,
    buildJobRootCauseGuidance: (job) => buildJobRootCauseGuidance(job, getAlertSettings().highCpuThreshold),
    getAvailableOperatorActions: (job) => {
        const actions = getAvailableOperatorActions(job);
        if (hasEntitlement(getEntitlements(), 'job-actions')) {
            return actions;
        }

        return actions.map((action) => ({
            ...action,
            enabled: false,
            reason: 'IBM i job actions require Premium.'
        }));
    },
    getAlertSettings,
    buildOperatorActionPlan,
    runOperatorCommand: async (
        command: string,
        payload: { kind: OperatorActionKind; jobName: string; },
        live: boolean
    ) => {
        if (!live) {
            loggingRuntime.recordActivity({
                area: 'monitoring',
                level: 'success',
                message: `Simulated operator action: ${payload.kind}.`,
                detail: `${LOCAL_OPERATOR_NAME} | ${payload.jobName} | ${command}`
            });
            return;
        }

        const service = sessionRuntime.getCurrentService();
        if (!service) {
            throw new Error('Not connected to IBM i');
        }

        await service.executeClCommand(command);
        loggingRuntime.recordActivity({
            area: 'monitoring',
            level: 'success',
            message: `Operator action completed: ${payload.kind}.`,
            detail: `${LOCAL_OPERATOR_NAME} | ${payload.jobName} | ${command}`
        });

        await monitoringRuntime.publishSystemStatus();
    },
    isLiveMonitorMode: () => monitoringState.getMonitorMode() === 'live',
    getOperatorName: getCurrentOperatorName,
    authorizeAction: authorizeCurrentOperatorAction,
    getCurrentSystemId,
    recordActionAudit: (entry) => {
        loggingRuntime.recordActivity({
            area: 'monitoring',
            level: entry.result === 'success' ? 'success' : 'error',
            message: `ActionBoard action ${entry.result}: ${entry.action}.`,
            detail: [
                `operator=${entry.operator}`,
                `job=${entry.jobName}`,
                entry.incidentId ? `incident=${entry.incidentId}` : undefined,
                entry.detail
            ].filter(Boolean).join(' | ')
        });
    },
    recordActivity: loggingRuntime.recordActivity,
    sendToWindow: windowRuntime.sendToWindow
});

registerResolutionMemoryIpc({
    getMemory: () => getNormalizedResolutionMemory(store),
    saveMemory: (memory) => saveResolutionMemory(store, memory),
    getJob: (jobName) => monitoringState.getJob(jobName),
    getAlert: (jobName) => alertState.getActiveAlerts().find((alert) => alert.jobName === jobName)
        || Object.values(alertState.getIncidentLedger()).find((alert) => alert.jobName === jobName),
    getSystemId: getCurrentSystemId,
    getSystemLabel: () => connectionState.getState().currentConnection?.name,
    getOperatorName: getCurrentOperatorName,
    authorizeAction: authorizeCurrentOperatorAction,
    recordActivity: loggingRuntime.recordActivity
});

registerProblemManagementIpc({
    getProblems: () => getNormalizedProblemManagement(store),
    saveProblems: (problems) => saveProblemManagement(store, problems),
    getJob: (jobName) => monitoringState.getJob(jobName),
    getAlert: (jobName) => alertState.getActiveAlerts().find((alert) => alert.jobName === jobName)
        || Object.values(alertState.getIncidentLedger()).find((alert) => alert.jobName === jobName),
    getSystemId: getCurrentSystemId,
    getSystemLabel: () => connectionState.getState().currentConnection?.name,
    getOperatorName: getCurrentOperatorName,
    authorizeAction: authorizeCurrentOperatorAction,
    recordActivity: loggingRuntime.recordActivity
});

registerIncidentReplayIpc({
    authorizeRead: () => authorizeCurrentOperatorAction('read', getCurrentSystemId()),
    recordActivity: loggingRuntime.recordActivity
});

registerRunbookIpc({
    requirePremium: () => requireEntitlement('job-actions'),
    getSystemId: getCurrentSystemId,
    getOperatorName: getCurrentOperatorName,
    authorizeAction: authorizeCurrentOperatorAction,
    getJob: (jobName) => monitoringState.getJob(jobName),
    getJobLog: async (jobName) => {
        if (monitoringState.getMonitorMode() === 'live') {
            const service = sessionRuntime.getCurrentService();
            if (!service) throw new Error('Not connected to IBM i');
            return service.getJobLog(jobName);
        }
        return getDemoDatabase().getJobLog(jobName);
    },
    getJobMessages: async (jobName) => {
        if (monitoringState.getMonitorMode() === 'live') {
            const service = sessionRuntime.getCurrentService();
            if (!service) throw new Error('Not connected to IBM i');
            return service.getJobMessages(jobName);
        }
        return getDemoDatabase().getJobMessages(jobName);
    },
    getIncidentResponse: (jobName) => {
        const job = monitoringState.getJob(jobName);
        if (!job) return null;
        const alert = alertState.getActiveAlerts().find((candidate) => candidate.jobName === jobName);
        return buildIncidentResponseSnapshot({
            job,
            alert,
            statusHistory: monitoringState.getJobStatusHistory(jobName),
            operatorName: getCurrentOperatorName(),
            systemId: getCurrentSystemId(),
            businessServiceSettings: getNormalizedBusinessServiceSettings(store)
        });
    },
    getHighCpuThreshold: () => getAlertSettings().highCpuThreshold,
    getExecutions: () => getNormalizedRunbookExecutions(store),
    saveExecutions: (executions) => saveRunbookExecutions(store, executions),
    buildOperatorActionPlan,
    runOperatorCommand: async (command, payload, live) => {
        if (!live) {
            loggingRuntime.recordActivity({
                area: 'monitoring',
                level: 'success',
                message: `Simulated runbook action: ${payload.kind}.`,
                detail: `${getCurrentOperatorName()} | ${payload.jobName} | ${command}`
            });
            return;
        }
        const service = sessionRuntime.getCurrentService();
        if (!service) throw new Error('Not connected to IBM i');
        await service.executeClCommand(command);
        loggingRuntime.recordActivity({
            area: 'monitoring',
            level: 'success',
            message: `Runbook action completed: ${payload.kind}.`,
            detail: `${getCurrentOperatorName()} | ${payload.jobName} | ${command}`
        });
        await monitoringRuntime.publishSystemStatus();
    },
    isLiveMonitorMode: () => monitoringState.getMonitorMode() === 'live',
    recordActionAudit: (entry) => {
        loggingRuntime.recordActivity({
            area: 'monitoring',
            level: entry.result === 'success' ? 'success' : 'error',
            message: `ActionBoard action ${entry.result}: ${entry.action}.`,
            detail: [
                `operator=${entry.operator}`,
                `job=${entry.jobName}`,
                entry.incidentId ? `incident=${entry.incidentId}` : undefined,
                entry.detail
            ].filter(Boolean).join(' | ')
        });
    }
});

app.whenReady().then(() => {
    const userDataDirectoryOverride = process.env.IBM_EYE_USER_DATA_DIR?.trim();
    if (userDataDirectoryOverride) {
        app.setPath('userData', userDataDirectoryOverride);
    }

    if (process.platform === 'darwin' && app.dock) {
        app.dock.setIcon(resolveAppIconPath());
    }

    sessionRuntime.migrateStoredConnections();
    windowRuntime.createWindow();
    void backgroundCollectorRuntime.startIfConfigured();
    loggingRuntime.recordActivity({
        area: 'navigation',
        level: 'info',
        message: 'iMonitor is ready.',
        detail: 'Waiting for the first IBM i connection.'
    });
    emitAlertSettings();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            windowRuntime.createWindow();
            if (connectionState.getState().isConnected) {
                windowRuntime.loadMonitorPage();
            }
            return;
        }
        windowRuntime.getWindow()?.show();
        windowRuntime.getWindow()?.focus();
    });
});

app.on('window-all-closed', () => {
    if (getNormalizedCollectorSettings(store).enabled) {
        return;
    }
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

ipcMain.on('start-monitoring', (_event, interval) => {
    monitoringRuntime.startMonitoring(interval);
});

ipcMain.on('stop-monitoring', () => {
    monitoringRuntime.stopMonitoring();
});
