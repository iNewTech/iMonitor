import { app, BrowserWindow, ipcMain } from 'electron/main';
import { Notification, nativeImage, safeStorage, shell } from 'electron';
import os from 'node:os';
import * as path from 'path';
import Db, { type ServiceLogEntry } from './services/ibmi';
import { DemoDatabase } from './services/demo-db';
import {
    acknowledgeAlertWorkflow,
    addAlertWorkflowNote,
    attachClickUpTaskToWorkflow,
    claimAlertWorkflow,
    markAlertWorkDone,
    releaseAlertWorkflow
} from './features/alerts/alert-operator-workflow';
import { normalizeAlertSettings } from './features/alerts/alert-model';
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
    shouldSendSlackAlert,
    toRenderableSlackSettings,
    toStoredSlackSettings,
    type SlackSettings
} from './features/integrations/slack/slack-model';
import {
    buildOperatorActionPlan,
    getAvailableOperatorActions,
    type OperatorActionKind
} from './features/action-board/operator-actions';
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
import { registerSlackIpc } from './main/ipc/slack-ipc';
import { registerSupportIpc } from './main/ipc/support-ipc';
import { createAiRuntime } from './main/runtime/ai-runtime';
import { createEmailNotificationRuntime } from './main/runtime/email-notification-runtime';
import { createClickUpRuntime } from './main/runtime/clickup-runtime';
import { createMonitoringRuntime } from './main/runtime/monitoring-runtime';
import { createLoggingRuntime } from './main/runtime/logging-runtime';
import { createSessionRuntime } from './main/runtime/session-runtime';
import { createSlackRuntime } from './main/runtime/slack-runtime';
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
    setStoredClickUpSettingsForUser,
    setStoredSlackSettingsForUser
} from './main/store';
import { createWindowRuntime } from './main/window/window-runtime';
import { protectPassword, revealPassword } from './utils/password-store';
import { getDemoDatabasePath } from './utils/demo-system';

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
        const shouldSendSlack = Boolean(
            hasEntitlement(getEntitlements(), 'slack-integration')
            &&
            slackRuntime.canSendAlerts()
            && shouldSendSlackAlert(getSlackSettings(), alert.kind)
        );

        if (!shouldSendSlack) {
            return;
        }

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
    openExternalUrl: (target) => shell.openExternal(target),
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
    recordActivity: loggingRuntime.recordActivity
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
