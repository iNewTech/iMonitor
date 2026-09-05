import { app, BrowserWindow, dialog, ipcMain } from 'electron/main';
import { Notification, nativeImage, safeStorage, shell } from 'electron';
import os from 'node:os';
import * as path from 'path';
import Db, { type ServiceLogEntry } from './services/ibmi';
import type { JobQueueRecord, PagedResult, QueuedJobRecord } from './services/ibmi';
import { DemoDatabase } from './services/demo-db';
import { DemoObjectAnalysisService } from './services/object-analysis';
import { IbmiObjectAnalysisService } from './services/object-analysis-live';
import {
    acknowledgeAlertWorkflow,
    addAlertWorkflowNote,
    attachClickUpTaskToWorkflow,
    claimAlertWorkflow,
    markAlertWorkDone,
    releaseAlertWorkflow
} from './features/alerts/alert-operator-workflow';
import { normalizeAlertSettings, shouldWatchAlert } from './features/alerts/alert-model';
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
import { createAiRuntime } from './main/runtime/ai-runtime';
import { createEmailNotificationRuntime } from './main/runtime/email-notification-runtime';
import { createClickUpRuntime } from './main/runtime/clickup-runtime';
import { createMonitoringRuntime } from './main/runtime/monitoring-runtime';
import { createLoggingRuntime } from './main/runtime/logging-runtime';
import { createSessionRuntime } from './main/runtime/session-runtime';
import { createSlackRuntime } from './main/runtime/slack-runtime';
import { createJiraRuntime } from './main/runtime/jira-runtime';
import { createSmsNotificationRuntime } from './main/runtime/sms-notification-runtime';
import { createSupportRuntime } from './main/runtime/support-runtime';
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
    setObjectAnalysisSettings
} from './main/store';
import { createWindowRuntime } from './main/window/window-runtime';
import { protectPassword, revealPassword } from './utils/password-store';
import { getDemoDatabasePath, getDemoObjectAnalysisPath } from './utils/demo-system';
import {
    buildObjectAnalysisAiContext,
    buildObjectAnalysisAiQuestion
} from './features/object-analysis/ai-prompt';
import {
    formatObjectAnalysisReport,
    normalizeObjectAnalysisSettings,
    type ObjectAnalysisResult,
    type ObjectAnalysisSettings
} from './features/object-analysis/model';
import { type AnalyzeObjectRequest } from './features/object-analysis/model';
import { buildDetailedProgramAnalysis } from './features/object-analysis/program-analysis';
import { persistObjectAnalysisReport } from './features/object-analysis/report-storage';
import { writeFile } from 'node:fs/promises';

const DEFAULT_MONITORING_INTERVAL = 5000;
const MAX_ACTIVITY_LOG_ENTRIES = 200;
const MAX_MONITORING_HISTORY = 90;
const MAX_JOB_STATUS_HISTORY = 12;
const NOTIFICATION_COOLDOWN_MS = 120000;
const SUPPORT_EMAIL = 'gajendertyagi.tyagi@gmail.com';
const SUPPORT_DIAGNOSTICS_PUBLIC_KEY = process.env.IMONITOR_SUPPORT_PUBLIC_KEY?.trim() || '';
const LOCAL_OPERATOR_NAME = os.userInfo().username?.trim() || 'local-operator';
const DEMO_OPERATOR_NAME = 'GajenderT';
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
    const currentConnection = connectionState.getState().currentConnection;
    const isDemoSession = monitoringState.getMonitorMode() === 'dummy'
        || currentConnection?.host === 'dummy.local'
        || currentConnection?.user === DEMO_OPERATOR_NAME;

    return isDemoSession
        ? DEMO_OPERATOR_NAME
        : LOCAL_OPERATOR_NAME;
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

function getLocalObjectAnalysisService(settings: ObjectAnalysisSettings) {
    return new DemoObjectAnalysisService(settings.localDirectory || getDemoObjectAnalysisPath());
}

async function getObjectAnalysisLibraryList(options?: {
    source?: ObjectAnalysisSettings['source'];
    localDirectory?: string;
}) {
    const currentSettings = await getObjectAnalysisRuntimeSettings();
    const source = options?.source || currentSettings.source;
    if (source === 'local') {
        const settings = {
            ...currentSettings,
            source: 'local' as const,
            localDirectory: options?.localDirectory ?? currentSettings.localDirectory
        };
        return getLocalObjectAnalysisService(settings).getLibraryListInfo();
    }

    if (isDemoSession() || !connectionState.getState().isConnected) {
        throw new Error('Connect to a live IBM i system before loading the IBM i library list.');
    }

    const service = sessionRuntime.getCurrentService();
    if (!service) {
        throw new Error('The IBM i session is not ready. Reconnect and try again.');
    }
    return {
        libraries: await new IbmiObjectAnalysisService(service).getEnvironmentLibraryList(),
        source: 'environment' as const
    };
}

async function getObjectAnalysisWorkspace(settings: ObjectAnalysisSettings) {
    if (settings.source === 'local') {
        return getLocalObjectAnalysisService(settings).getWorkspace(settings);
    }

    if (isDemoSession() || !connectionState.getState().isConnected) {
        throw new Error('Connect to a live IBM i system before loading IBM i libraries.');
    }

    const service = sessionRuntime.getCurrentService();
    if (!service) {
        throw new Error('The IBM i session is not ready. Reconnect and try again.');
    }
    return new IbmiObjectAnalysisService(service).getWorkspace(settings);
}

async function persistDetailedObjectAnalysis(
    result: ObjectAnalysisResult,
    sourceText: string,
    settings: ObjectAnalysisSettings
) {
    const appStorageRoot = path.join(app.getPath('userData'), 'object-analysis');
    if (settings.source === 'local') {
        const sourceRoot = settings.localDirectory || getDemoObjectAnalysisPath();
        const artifact = await persistObjectAnalysisReport(sourceRoot, result, sourceText, 'source-directory');
        if (artifact.mode !== 'error') return artifact;
    }
    return persistObjectAnalysisReport(appStorageRoot, result, sourceText, 'app-storage');
}

async function analyzeObject(request: AnalyzeObjectRequest, settings: ObjectAnalysisSettings) {
    let result: ObjectAnalysisResult;
    if (settings.source === 'local') {
        result = await getLocalObjectAnalysisService(settings).analyzeObject(request, settings);
    } else {
        if (isDemoSession() || !connectionState.getState().isConnected) {
            throw new Error('Connect to a live IBM i system before analyzing IBM i source.');
        }

        const service = sessionRuntime.getCurrentService();
        if (!service) {
            throw new Error('The IBM i session is not ready. Reconnect and try again.');
        }
        result = await new IbmiObjectAnalysisService(service).analyzeObject(request, settings);
    }

    const sourceText = await getObjectAnalysisSourceContent(request, settings);
    const detailed = buildDetailedProgramAnalysis(result, sourceText);
    detailed.approval = { status: 'draft' };
    delete detailed.reportArtifact;
    return detailed;
}

async function getObjectAnalysisSourceContent(request: AnalyzeObjectRequest, settings: ObjectAnalysisSettings) {
    if (settings.source === 'local') {
        return getLocalObjectAnalysisService(settings).getSourceContent(request, settings);
    }

    if (isDemoSession() || !connectionState.getState().isConnected) {
        throw new Error('Connect to a live IBM i system before loading IBM i source.');
    }

    const service = sessionRuntime.getCurrentService();
    if (!service) {
        throw new Error('The IBM i session is not ready. Reconnect and try again.');
    }
    return new IbmiObjectAnalysisService(service).getSourceContent(request, settings);
}

async function analyzeObjectWithAi(request: AnalyzeObjectRequest, existingResult?: ObjectAnalysisResult) {
    const settings = await getObjectAnalysisRuntimeSettings();
    const result = existingResult || await analyzeObject(request, settings);
    const sourceText = await getObjectAnalysisSourceContent(request, settings);
    const response = await aiRuntime.askAssistant({
        message: buildObjectAnalysisAiQuestion(result),
        additionalContext: buildObjectAnalysisAiContext(result, sourceText)
    });
    if (response.success && response.reply) {
        result.approval = { status: 'draft' };
        delete result.reportArtifact;
        result.aiReport = {
            content: response.reply,
            providerLabel: response.availability.providerLabel,
            model: response.availability.selectedModel || 'configured model',
            generatedAt: new Date().toISOString()
        };
        return { ...response, result };
    }
    return response;
}

async function approveObjectAnalysis(request: AnalyzeObjectRequest, result: ObjectAnalysisResult) {
    const settings = await getObjectAnalysisRuntimeSettings();
    const sourceText = await getObjectAnalysisSourceContent(request, settings);
    result.approval = {
        status: 'approved',
        approvedAt: new Date().toISOString(),
        approvedBy: getCurrentOperatorName()
    };
    delete result.reportArtifact;
    const artifact = await persistDetailedObjectAnalysis(result, sourceText, settings);
    if (artifact.mode === 'error') {
        result.approval = { status: 'draft' };
        return { success: false, result, error: artifact.error || artifact.message };
    }
    return { success: true, result, artifact };
}

async function saveObjectAnalysisLibraryList(value: string[]) {
    const settings = await getObjectAnalysisRuntimeSettings();
    if (settings.source !== 'local') {
        throw new Error('Permanent setup-file saves are available when a local source directory is selected.');
    }

    const saved = await getLocalObjectAnalysisService(settings).saveLibraryList(value);
    const nextSettings = await setObjectAnalysisRuntimeSettings({
        libraryList: saved.libraries,
        libraries: saved.libraries
    });
    return { ...saved, settings: nextSettings };
}

async function selectObjectAnalysisDirectory() {
    const selection = await dialog.showOpenDialog({
        title: 'Choose local IBM i source directory',
        properties: ['openDirectory', 'createDirectory']
    });
    return selection.canceled ? null : (selection.filePaths[0] || null);
}

async function saveObjectAnalysisReport(result: ObjectAnalysisResult) {
    const suggestedName = `${result.root.library}-${result.root.name}-analysis.md`.toLowerCase();
    const selection = await dialog.showSaveDialog({
        title: 'Save object analysis report',
        defaultPath: path.join(app.getPath('downloads'), suggestedName),
        filters: [{ name: 'Markdown report', extensions: ['md'] }, { name: 'All files', extensions: ['*'] }]
    });

    if (selection.canceled || !selection.filePath) {
        return { success: false, error: 'Report save canceled.' };
    }

    try {
        await writeFile(selection.filePath, formatObjectAnalysisReport(result), 'utf8');
        loggingRuntime.recordActivity({
            area: 'monitoring',
            level: 'success',
            message: 'Object analysis report saved.',
            detail: selection.filePath
        });
        return { success: true, filePath: selection.filePath };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unable to save the analysis report.'
        };
    }
}

const windowRuntime = createWindowRuntime({
    preloadPath: path.join(__dirname, 'preload.js'),
    isDevelopment: process.env.NODE_ENV === 'development',
    iconPath: resolveAppIconPath(),
    onClosed: () => {
        sessionRuntime.handleWindowClosed();
    }
});

const alertState = createAlertStateStore({
    initialWorkflowStateByAlertId: store.get('alertWorkflowState') ?? {},
    persistWorkflowState: (workflowStateByAlertId) => {
        store.set('alertWorkflowState', workflowStateByAlertId);
    },
    onAlertsChanged: (alerts) => {
        windowRuntime.sendToWindow('alerts-updated', alerts);
    },
    onAlertCreated: async (alert) => {
        const shouldDeliverAlert = shouldWatchAlert(getAlertSettings(), alert.kind);
        const shouldSendSlack = Boolean(
            hasEntitlement(getEntitlements(), 'slack-integration')
            &&
            slackRuntime.canSendAlerts()
            && shouldDeliverAlert
        );

        if (shouldSendSlack) {
            try {
                await slackRuntime.sendAlert(alert);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                loggingRuntime.recordActivity({
                    area: 'monitoring',
                    level: 'warning',
                    message: 'Slack alert delivery failed.',
                    detail: `${alert.id}\n${message}`
                });
            }
        }

        const shouldSendJira = Boolean(
            hasEntitlement(getEntitlements(), 'jira-integration')
            && jiraRuntime.canSendAlerts()
            && shouldDeliverAlert
        );

        if (shouldSendJira) {
            try {
                await jiraRuntime.sendAlert(alert);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                loggingRuntime.recordActivity({
                    area: 'monitoring',
                    level: 'warning',
                    message: 'Jira alert delivery failed.',
                    detail: `${alert.id}\n${message}`
                });
            }
        }
    }
});

const loggingRuntime = createLoggingRuntime({
    userDataPath: app.getPath('userData'),
    getConnectionContext: () => {
        const state = connectionState.getState();
        return {
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

const clickUpRuntime = createClickUpRuntime({
    getSettings: getClickUpSettings,
    saveSettings: (settings) => saveClickUpSettings(settings),
    getOperatorName: getCurrentOperatorName,
    getJobReadableLogFilePath: (jobName) => loggingRuntime.getJobReadableLogFilePath(jobName),
    recordActivity: loggingRuntime.recordActivity
});

async function createClickUpTaskForClaimedAlert(alertId: string) {
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
            message: 'Alert work started without a ClickUp task.',
            detail: 'Configure ClickUp and select a target list to create tickets when operators start work.'
        });
        return;
    }

    try {
        const task = await clickUpRuntime.createTaskForAlert(alert, { assignToOperator: true });
        alertState.mutateAlertWorkflow(alertId, (state) => (
            attachClickUpTaskToWorkflow(state, task, new Date().toISOString())
        ));

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
    getActivityLog: () => loggingRuntime.getActivityLog(),
    getHighCpuThreshold: () => getAlertSettings().highCpuThreshold,
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

const monitoringRuntime = createMonitoringRuntime({
    getCurrentService: () => sessionRuntime.getCurrentService(),
    getDemoDatabase,
    getAlertSettings,
    monitoringState,
    alertState,
    recordActivity: loggingRuntime.recordActivity,
    sendToWindow: windowRuntime.sendToWindow,
    notify: notifyOperators,
    persistPoll: loggingRuntime.persistPoll
});

sessionRuntime = createSessionRuntime({
    store,
    connectionState,
    monitoringState,
    clearRuntimeMonitoringState: monitoringRuntime.clearRuntimeMonitoringState,
    clearDemoWorkflowLinks: alertState.clearDemoWorkflowLinks,
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

registerNavigationIpc({
    canOpenMonitor: () => connectionState.getState().isConnected,
    loadMonitorPage: windowRuntime.loadMonitorPage,
    loadConnectionPage: windowRuntime.loadConnectionPage,
    loadSettingsPage: windowRuntime.loadSettingsPage,
    loadObjectAnalysisPage: windowRuntime.loadObjectAnalysisPage,
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
    recordActivity: loggingRuntime.recordActivity
});

registerLogsIpc({
    getMonitoringHistory: () => monitoringState.getMonitoringHistory().slice()
});

registerSupportIpc({
    getAppInfo: () => supportRuntime.getAppInfo(),
    contactSupport: () => supportRuntime.contactSupport(),
    sendSupportDiagnostics: () => supportRuntime.sendSupportDiagnostics()
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
    askAssistant: (payload) => aiRuntime.askAssistant(payload)
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
    syncLinkedExternalWorkItem: async (payload) => {
        await clickUpRuntime.syncAlertWorkflowComment(payload);
    },
    createClickUpTaskForClaimedAlert,
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
    getJobQueues: async (options: JobQueueQuery): Promise<PagedResult<JobQueueRecord>> => {
        const result = monitoringState.getMonitorMode() === 'live'
            ? await (() => {
                const service = sessionRuntime.getCurrentService();
                if (!service) {
                    throw new Error('Not connected to IBM i');
                }
                return service.getJobQueues(options);
            })()
            : getDemoDatabase().getJobQueues(options);

        return {
            ...result,
            data: result.data.map((record) => normalizeJobQueueRecord(record as unknown as Record<string, unknown>))
        };
    },
    getJobQueueDetails: async (queueName: string, queueLibrary: string) => {
        if (monitoringState.getMonitorMode() === 'live') {
            const service = sessionRuntime.getCurrentService();
            if (!service) {
                throw new Error('Not connected to IBM i');
            }
            const queue = await service.getJobQueueDetails(queueName, queueLibrary);
            const subsystemName = String(queue?.SUBSYSTEM_NAME || '').trim();
            const subsystemLibrary = String(queue?.SUBSYSTEM_LIBRARY_NAME || 'QSYS').trim() || 'QSYS';
            return {
                queue,
                subsystem: subsystemName
                    ? await service.getSubsystemDetails(subsystemName, subsystemLibrary)
                    : null
            };
        }

        const database = getDemoDatabase();
        const queue = database.getJobQueueDetails(queueName, queueLibrary);
        const subsystemName = String(queue?.SUBSYSTEM_NAME || '').trim();
        const subsystemLibrary = String(queue?.SUBSYSTEM_LIBRARY_NAME || 'QSYS').trim() || 'QSYS';
        return {
            queue,
            subsystem: subsystemName ? database.getSubsystemDetails(subsystemName, subsystemLibrary) : null
        };
    },
    getQueuedJobs: async (options: QueuedJobQuery): Promise<PagedResult<QueuedJobRecord>> => {
        const result = monitoringState.getMonitorMode() === 'live'
            ? await (() => {
                const service = sessionRuntime.getCurrentService();
                if (!service) {
                    throw new Error('Not connected to IBM i');
                }
                return service.getQueuedJobs(options);
            })()
            : getDemoDatabase().getQueuedJobs(options);

        return {
            ...result,
            data: result.data.map((record) => normalizeQueuedJobRecord(record as unknown as Record<string, unknown>))
        };
    },
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
        }
    });
});

app.on('window-all-closed', () => {
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
