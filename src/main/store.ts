import { app } from 'electron/main';
import Store from 'electron-store';
import { DEFAULT_ALERT_SETTINGS, normalizeAlertSettings, type AlertSettings } from '../features/alerts/alert-model';
import {
    DEFAULT_STORED_EMAIL_NOTIFICATION_SETTINGS,
    normalizeStoredEmailNotificationSettings,
    type StoredEmailNotificationSettings
} from '../features/notifications/email-notification';
import {
    DEFAULT_AI_ASSISTANT_SETTINGS,
    DEFAULT_STORED_AI_ASSISTANT_SETTINGS,
    normalizeAiAssistantSettings,
    normalizeStoredAiAssistantSettings,
    type StoredAiAssistantSettings,
    type AiAssistantSettings
} from '../features/ibmeyeai/ai-model';
import {
    DEFAULT_STORED_CLICKUP_SETTINGS_BY_USER,
    DEFAULT_STORED_CLICKUP_SETTINGS,
    normalizeClickUpSettingsUserKey,
    normalizeStoredClickUpSettingsByUser,
    normalizeStoredClickUpSettings,
    type StoredClickUpSettings,
    type StoredClickUpSettingsByUser
} from '../features/integrations/clickup/clickup-model';
import {
    DEFAULT_STORED_SLACK_SETTINGS_BY_USER,
    DEFAULT_STORED_SLACK_SETTINGS,
    normalizeSlackSettingsUserKey,
    normalizeStoredSlackSettingsByUser,
    normalizeStoredSlackSettings,
    type StoredSlackSettings,
    type StoredSlackSettingsByUser
} from '../features/integrations/slack/slack-model';
import {
    DEFAULT_STORED_JIRA_SETTINGS_BY_USER,
    DEFAULT_STORED_JIRA_SETTINGS,
    normalizeJiraSettingsUserKey,
    normalizeStoredJiraSettingsByUser,
    normalizeStoredJiraSettings,
    type StoredJiraSettings,
    type StoredJiraSettingsByUser
} from '../features/integrations/jira/jira-model';
import {
    DEFAULT_STORED_SMS_NOTIFICATION_SETTINGS_BY_USER,
    DEFAULT_STORED_SMS_NOTIFICATION_SETTINGS,
    normalizeSmsSettingsUserKey,
    normalizeStoredSmsNotificationSettingsByUser,
    normalizeStoredSmsNotificationSettings,
    type StoredSmsNotificationSettings,
    type StoredSmsNotificationSettingsByUser
} from '../features/notifications/sms-notification';
import { DEFAULT_THEME_ID, normalizeThemeId, type ThemeId } from '../features/theme/theme-model';
import type { Plan } from '../features/entitlements/entitlements';
import type { StoredConnection } from '../utils/connections';
import type { StoredAlertWorkflowState } from '../features/alerts/alert-model';
import {
    getStableDemoIncidentId,
    migrateLegacyDemoIncidents,
    normalizeIncidentLedger,
    type IncidentLedger
} from '../features/alerts/incident-ledger';
import { DEMO_CONNECTION_ID, DEMO_CONNECTION_NAME } from '../features/demo/demo-runtime';
import {
    DEFAULT_OBJECT_ANALYSIS_SETTINGS,
    normalizeObjectAnalysisSettings,
    type ObjectAnalysisSettings
} from '../features/object-analysis/model';
import { normalizeQueueTriageResults, type QueueTriageResult } from '../features/action-board/queue-triage';
import type { IntegrationDeliveryStatus } from '../features/integrations/delivery';
import { normalizeSupportAccessGrants, type SupportAccessGrants } from '../features/action-board/support-access';
import { DEFAULT_COLLECTOR_SETTINGS, normalizeCollectorSettings, type CollectorSettings } from '../features/collector/collector-model';
import { DEFAULT_BUSINESS_SERVICE_SETTINGS, normalizeBusinessServiceSettings, type BusinessServiceSettings } from '../features/action-board/business-service-mapping';
import { DEFAULT_RESOLUTION_MEMORY, normalizeResolutionMemory, type ResolutionMemoryStore } from '../features/action-board/resolution-memory';
import { DEFAULT_RUNBOOK_EXECUTIONS, normalizeRunbookExecutions, type RunbookExecutionStore } from '../features/action-board/runbook-execution';
import { DEFAULT_PROBLEM_MANAGEMENT, normalizeProblemManagement, type ProblemManagementStore } from '../features/action-board/problem-management';

export interface StoreSchema {
    connections: StoredConnection[];
    alertSettings: AlertSettings;
    emailNotificationSettings: StoredEmailNotificationSettings;
    aiAssistantSettings: StoredAiAssistantSettings;
    clickUpSettingsByUser: StoredClickUpSettingsByUser;
    clickUpSettings: StoredClickUpSettings;
    slackSettingsByUser: StoredSlackSettingsByUser;
    slackSettings: StoredSlackSettings;
    jiraSettingsByUser: StoredJiraSettingsByUser;
    jiraSettings: StoredJiraSettings;
    smsNotificationSettingsByUser: StoredSmsNotificationSettingsByUser;
    smsNotificationSettings: StoredSmsNotificationSettings;
    alertWorkflowState: Record<string, StoredAlertWorkflowState>;
    integrationDeliveryStatus: Record<string, IntegrationDeliveryStatus>;
    supportAccessGrants: SupportAccessGrants;
    incidentLedger: IncidentLedger;
    queueTriageResults: Record<string, QueueTriageResult>;
    objectAnalysisSettings: ObjectAnalysisSettings;
    collectorSettings: CollectorSettings;
    businessServiceSettings: BusinessServiceSettings;
    resolutionMemory: ResolutionMemoryStore;
    runbookExecutions: RunbookExecutionStore;
    problemManagement: ProblemManagementStore;
    themeId: ThemeId;
    developmentPlan: Plan;
}

export type AppStore = Store<StoreSchema> & {
    get<K extends keyof StoreSchema>(key: K): StoreSchema[K];
    set<K extends keyof StoreSchema>(key: K, value: StoreSchema[K]): void;
};

/**
 * Creates the typed Electron store used by the iMonitor main process.
 */
export function createAppStore() {
    const storeName = app.isPackaged ? 'connections-prod' : 'connections-dev';
    const storeDirectoryOverride = process.env.IBM_EYE_STORE_DIR?.trim();

    return new Store<StoreSchema>({
        name: storeName,
        cwd: storeDirectoryOverride || undefined,
        defaults: {
            connections: [],
            alertSettings: DEFAULT_ALERT_SETTINGS,
            emailNotificationSettings: DEFAULT_STORED_EMAIL_NOTIFICATION_SETTINGS,
            aiAssistantSettings: DEFAULT_STORED_AI_ASSISTANT_SETTINGS,
            clickUpSettingsByUser: DEFAULT_STORED_CLICKUP_SETTINGS_BY_USER,
            clickUpSettings: DEFAULT_STORED_CLICKUP_SETTINGS,
            slackSettingsByUser: DEFAULT_STORED_SLACK_SETTINGS_BY_USER,
            slackSettings: DEFAULT_STORED_SLACK_SETTINGS,
            jiraSettingsByUser: DEFAULT_STORED_JIRA_SETTINGS_BY_USER,
            jiraSettings: DEFAULT_STORED_JIRA_SETTINGS,
            smsNotificationSettingsByUser: DEFAULT_STORED_SMS_NOTIFICATION_SETTINGS_BY_USER,
            smsNotificationSettings: DEFAULT_STORED_SMS_NOTIFICATION_SETTINGS,
            alertWorkflowState: {},
            integrationDeliveryStatus: {},
            supportAccessGrants: {},
            incidentLedger: {},
            queueTriageResults: {},
            objectAnalysisSettings: DEFAULT_OBJECT_ANALYSIS_SETTINGS,
            collectorSettings: DEFAULT_COLLECTOR_SETTINGS,
            businessServiceSettings: DEFAULT_BUSINESS_SERVICE_SETTINGS,
            resolutionMemory: DEFAULT_RESOLUTION_MEMORY,
            runbookExecutions: DEFAULT_RUNBOOK_EXECUTIONS,
            problemManagement: DEFAULT_PROBLEM_MANAGEMENT,
            themeId: DEFAULT_THEME_ID,
            developmentPlan: 'premium'
        }
    }) as AppStore;
}

/** Loads and normalizes customer-owned business service mappings. */
export function getNormalizedBusinessServiceSettings(store: AppStore) {
    const storedSettings = store.get('businessServiceSettings');
    const normalized = normalizeBusinessServiceSettings(storedSettings);
    if (JSON.stringify(storedSettings) !== JSON.stringify(normalized)) {
        store.set('businessServiceSettings', normalized);
    }
    return normalized;
}

/** Persists the bounded business service mapping set. */
export function saveBusinessServiceSettings(store: AppStore, candidate?: Partial<BusinessServiceSettings>) {
    const normalized = normalizeBusinessServiceSettings(candidate);
    store.set('businessServiceSettings', normalized);
    return normalized;
}

/** Loads and normalizes customer-owned resolution memory. */
export function getNormalizedResolutionMemory(store: AppStore) {
    const storedMemory = store.get('resolutionMemory');
    const normalized = normalizeResolutionMemory(storedMemory);
    if (JSON.stringify(storedMemory) !== JSON.stringify(normalized)) {
        store.set('resolutionMemory', normalized);
    }
    return normalized;
}

/** Persists the bounded resolution memory store. */
export function saveResolutionMemory(store: AppStore, candidate?: Partial<ResolutionMemoryStore>) {
    const normalized = normalizeResolutionMemory(candidate);
    store.set('resolutionMemory', normalized);
    return normalized;
}

/** Loads and normalizes persisted runbook execution checkpoints. */
export function getNormalizedRunbookExecutions(store: AppStore) {
    const storedExecutions = store.get('runbookExecutions');
    const normalized = normalizeRunbookExecutions(storedExecutions);
    if (JSON.stringify(storedExecutions) !== JSON.stringify(normalized)) {
        store.set('runbookExecutions', normalized);
    }
    return normalized;
}

/** Persists bounded customer-scoped runbook execution history. */
export function saveRunbookExecutions(store: AppStore, candidate?: Partial<RunbookExecutionStore>) {
    const normalized = normalizeRunbookExecutions(candidate);
    store.set('runbookExecutions', normalized);
    return normalized;
}

/** Loads and normalizes the bounded L3 problem workspace. */
export function getNormalizedProblemManagement(store: AppStore) {
    const storedProblems = store.get('problemManagement');
    const normalized = normalizeProblemManagement(storedProblems);
    if (JSON.stringify(storedProblems) !== JSON.stringify(normalized)) {
        store.set('problemManagement', normalized);
    }
    return normalized;
}

/** Persists customer-scoped recurring-problem records. */
export function saveProblemManagement(store: AppStore, candidate?: Partial<ProblemManagementStore>) {
    const normalized = normalizeProblemManagement(candidate);
    store.set('problemManagement', normalized);
    return normalized;
}

/** Loads and normalizes the client-owned background collector settings. */
export function getNormalizedCollectorSettings(store: AppStore) {
    const storedSettings = store.get('collectorSettings');
    const normalized = normalizeCollectorSettings(storedSettings);
    if (JSON.stringify(storedSettings) !== JSON.stringify(normalized)) {
        store.set('collectorSettings', normalized);
    }
    return normalized;
}

/** Loads and normalizes the client-owned support access grants. */
export function getNormalizedSupportAccessGrants(store: AppStore) {
    const storedGrants = store.get('supportAccessGrants');
    const normalized = normalizeSupportAccessGrants(storedGrants);
    if (JSON.stringify(storedGrants) !== JSON.stringify(normalized)) {
        store.set('supportAccessGrants', normalized);
    }
    return normalized;
}

/** Loads and normalizes the persisted read-only queue triage evidence. */
export function getNormalizedQueueTriageResults(store: AppStore) {
    const storedResults = store.get('queueTriageResults');
    const normalized = normalizeQueueTriageResults(storedResults);
    if (JSON.stringify(storedResults) !== JSON.stringify(normalized)) {
        store.set('queueTriageResults', normalized);
    }
    return normalized;
}

/** Loads durable incidents and drops incomplete records without blocking startup. */
export function getNormalizedIncidentLedger(store: AppStore) {
    const storedLedger = store.get('incidentLedger');
    const normalized = migrateLegacyDemoIncidents(
        normalizeIncidentLedger(storedLedger),
        DEMO_CONNECTION_ID,
        DEMO_CONNECTION_NAME
    );
    const storedWorkflowState = store.get('alertWorkflowState');
    const migratedWorkflowState = Object.fromEntries(
        Object.entries(storedWorkflowState).map(([id, state]) => id.startsWith('demo-')
            ? [getStableDemoIncidentId(id, DEMO_CONNECTION_ID), state]
            : [id, state])
    );
    if (JSON.stringify(storedWorkflowState) !== JSON.stringify(migratedWorkflowState)) {
        store.set('alertWorkflowState', migratedWorkflowState);
    }
    if (JSON.stringify(storedLedger) !== JSON.stringify(normalized)) {
        store.set('incidentLedger', normalized);
    }
    return normalized;
}

/**
 * Loads alert settings from the store and normalizes them.
 */
export function getNormalizedAlertSettings(store: AppStore) {
    const storedSettings = store.get('alertSettings');
    const normalized = normalizeAlertSettings(storedSettings);

    if (JSON.stringify(storedSettings) !== JSON.stringify(normalized)) {
        store.set('alertSettings', normalized);
    }

    return normalized;
}

/**
 * Loads encrypted email notification settings from the store and normalizes them.
 */
export function getNormalizedStoredEmailNotificationSettings(store: AppStore) {
    const storedSettings = store.get('emailNotificationSettings');
    const normalized = normalizeStoredEmailNotificationSettings(storedSettings);

    if (JSON.stringify(storedSettings) !== JSON.stringify(normalized)) {
        store.set('emailNotificationSettings', normalized);
    }

    return normalized;
}

/**
 * Loads and normalizes the persisted theme identifier.
 */
export function getNormalizedThemeId(store: AppStore) {
    const storedThemeId = store.get('themeId');
    const normalizedThemeId = normalizeThemeId(storedThemeId);

    if (storedThemeId !== normalizedThemeId) {
        store.set('themeId', normalizedThemeId);
    }

    return normalizedThemeId;
}

/**
 * Loads and normalizes persisted AI assistant settings.
 */
export function getNormalizedAiAssistantSettings(store: AppStore) {
    const storedSettings = store.get('aiAssistantSettings');
    const normalized = normalizeStoredAiAssistantSettings(storedSettings);

    if (JSON.stringify(storedSettings) !== JSON.stringify(normalized)) {
        store.set('aiAssistantSettings', normalized);
    }

    return normalized;
}

/** Loads and normalizes the persisted object-analysis scan scope. */
export function getNormalizedObjectAnalysisSettings(store: AppStore) {
    const storedSettings = store.get('objectAnalysisSettings');
    const normalized = normalizeObjectAnalysisSettings(storedSettings);

    if (JSON.stringify(storedSettings) !== JSON.stringify(normalized)) {
        store.set('objectAnalysisSettings', normalized);
    }

    return normalized;
}

/** Persists a normalized object-analysis scan scope. */
export function setObjectAnalysisSettings(
    store: AppStore,
    candidate: Partial<ObjectAnalysisSettings> | undefined
) {
    const normalized = normalizeObjectAnalysisSettings({
        ...getNormalizedObjectAnalysisSettings(store),
        ...(candidate || {})
    });
    store.set('objectAnalysisSettings', normalized);
    return normalized;
}

/**
 * Loads encrypted ClickUp integration settings from the store and normalizes them.
 */
export function getNormalizedStoredClickUpSettings(store: AppStore, operatorName: string) {
    const normalizedOperatorName = normalizeClickUpSettingsUserKey(operatorName);
    const storedSettingsByUser = store.get('clickUpSettingsByUser');
    const normalizedSettingsByUser = normalizeStoredClickUpSettingsByUser(storedSettingsByUser);

    if (JSON.stringify(storedSettingsByUser) !== JSON.stringify(normalizedSettingsByUser)) {
        store.set('clickUpSettingsByUser', normalizedSettingsByUser);
    }

    const storedSettings = normalizedSettingsByUser[normalizedOperatorName];
    if (storedSettings) {
        return storedSettings;
    }

    const legacyStoredSettings = store.get('clickUpSettings');
    const normalizedLegacySettings = normalizeStoredClickUpSettings(legacyStoredSettings);
    if (JSON.stringify(legacyStoredSettings) !== JSON.stringify(normalizedLegacySettings)) {
        store.set('clickUpSettings', normalizedLegacySettings);
    }

    const hasLegacySettings = JSON.stringify(normalizedLegacySettings) !== JSON.stringify(DEFAULT_STORED_CLICKUP_SETTINGS);
    if (!hasLegacySettings) {
        return normalizedLegacySettings;
    }

    const nextSettingsByUser = {
        ...normalizedSettingsByUser,
        [normalizedOperatorName]: normalizedLegacySettings
    };
    store.set('clickUpSettingsByUser', nextSettingsByUser);
    return normalizedLegacySettings;
}

/**
 * Persists one operator's encrypted ClickUp settings.
 */
export function setStoredClickUpSettingsForUser(
    store: AppStore,
    operatorName: string,
    settings: StoredClickUpSettings
) {
    const normalizedOperatorName = normalizeClickUpSettingsUserKey(operatorName);
    const nextSettingsByUser = {
        ...normalizeStoredClickUpSettingsByUser(store.get('clickUpSettingsByUser')),
        [normalizedOperatorName]: normalizeStoredClickUpSettings(settings)
    };

    store.set('clickUpSettingsByUser', nextSettingsByUser);
}

/**
 * Loads encrypted Slack settings for one operator and migrates the legacy value once.
 */
export function getNormalizedStoredSlackSettings(store: AppStore, operatorName: string) {
    const normalizedOperatorName = normalizeSlackSettingsUserKey(operatorName);
    const storedSettingsByUser = store.get('slackSettingsByUser');
    const normalizedSettingsByUser = normalizeStoredSlackSettingsByUser(storedSettingsByUser);

    if (JSON.stringify(storedSettingsByUser) !== JSON.stringify(normalizedSettingsByUser)) {
        store.set('slackSettingsByUser', normalizedSettingsByUser);
    }

    const storedSettings = normalizedSettingsByUser[normalizedOperatorName];
    if (storedSettings) {
        return storedSettings;
    }

    const legacyStoredSettings = store.get('slackSettings');
    const normalizedLegacySettings = normalizeStoredSlackSettings(legacyStoredSettings);
    if (JSON.stringify(legacyStoredSettings) !== JSON.stringify(normalizedLegacySettings)) {
        store.set('slackSettings', normalizedLegacySettings);
    }

    const hasLegacySettings = JSON.stringify(normalizedLegacySettings) !== JSON.stringify(DEFAULT_STORED_SLACK_SETTINGS);
    if (!hasLegacySettings) {
        return normalizedLegacySettings;
    }

    const nextSettingsByUser = {
        ...normalizedSettingsByUser,
        [normalizedOperatorName]: normalizedLegacySettings
    };
    store.set('slackSettingsByUser', nextSettingsByUser);
    return normalizedLegacySettings;
}

/**
 * Persists one operator's encrypted Slack settings.
 */
export function setStoredSlackSettingsForUser(
    store: AppStore,
    operatorName: string,
    settings: StoredSlackSettings
) {
    const normalizedOperatorName = normalizeSlackSettingsUserKey(operatorName);
    const nextSettingsByUser = {
        ...normalizeStoredSlackSettingsByUser(store.get('slackSettingsByUser')),
        [normalizedOperatorName]: normalizeStoredSlackSettings(settings)
    };

    store.set('slackSettingsByUser', nextSettingsByUser);
}

/** Loads encrypted Jira settings for one operator and migrates the legacy value once. */
export function getNormalizedStoredJiraSettings(store: AppStore, operatorName: string) {
    const normalizedOperatorName = normalizeJiraSettingsUserKey(operatorName);
    const storedSettingsByUser = store.get('jiraSettingsByUser');
    const normalizedSettingsByUser = normalizeStoredJiraSettingsByUser(storedSettingsByUser);

    if (JSON.stringify(storedSettingsByUser) !== JSON.stringify(normalizedSettingsByUser)) {
        store.set('jiraSettingsByUser', normalizedSettingsByUser);
    }

    const storedSettings = normalizedSettingsByUser[normalizedOperatorName];
    if (storedSettings) {
        return storedSettings;
    }

    const legacyStoredSettings = store.get('jiraSettings');
    const normalizedLegacySettings = normalizeStoredJiraSettings(legacyStoredSettings);
    if (JSON.stringify(legacyStoredSettings) !== JSON.stringify(normalizedLegacySettings)) {
        store.set('jiraSettings', normalizedLegacySettings);
    }

    const hasLegacySettings = JSON.stringify(normalizedLegacySettings) !== JSON.stringify(DEFAULT_STORED_JIRA_SETTINGS);
    if (!hasLegacySettings) {
        return normalizedLegacySettings;
    }

    const nextSettingsByUser = {
        ...normalizedSettingsByUser,
        [normalizedOperatorName]: normalizedLegacySettings
    };
    store.set('jiraSettingsByUser', nextSettingsByUser);
    return normalizedLegacySettings;
}

/** Persists one operator's encrypted Jira settings. */
export function setStoredJiraSettingsForUser(
    store: AppStore,
    operatorName: string,
    settings: StoredJiraSettings
) {
    const normalizedOperatorName = normalizeJiraSettingsUserKey(operatorName);
    const nextSettingsByUser = {
        ...normalizeStoredJiraSettingsByUser(store.get('jiraSettingsByUser')),
        [normalizedOperatorName]: normalizeStoredJiraSettings(settings)
    };

    store.set('jiraSettingsByUser', nextSettingsByUser);
}

/** Loads encrypted SMS settings for one operator and migrates the legacy value once. */
export function getNormalizedStoredSmsNotificationSettings(store: AppStore, operatorName: string) {
    const normalizedOperatorName = normalizeSmsSettingsUserKey(operatorName);
    const storedSettingsByUser = store.get('smsNotificationSettingsByUser');
    const normalizedSettingsByUser = normalizeStoredSmsNotificationSettingsByUser(storedSettingsByUser);

    if (JSON.stringify(storedSettingsByUser) !== JSON.stringify(normalizedSettingsByUser)) {
        store.set('smsNotificationSettingsByUser', normalizedSettingsByUser);
    }

    const storedSettings = normalizedSettingsByUser[normalizedOperatorName];
    if (storedSettings) {
        return storedSettings;
    }

    const legacyStoredSettings = store.get('smsNotificationSettings');
    const normalizedLegacySettings = normalizeStoredSmsNotificationSettings(legacyStoredSettings);
    if (JSON.stringify(legacyStoredSettings) !== JSON.stringify(normalizedLegacySettings)) {
        store.set('smsNotificationSettings', normalizedLegacySettings);
    }

    const hasLegacySettings = JSON.stringify(normalizedLegacySettings)
        !== JSON.stringify(DEFAULT_STORED_SMS_NOTIFICATION_SETTINGS);
    if (!hasLegacySettings) {
        return normalizedLegacySettings;
    }

    const nextSettingsByUser = {
        ...normalizedSettingsByUser,
        [normalizedOperatorName]: normalizedLegacySettings
    };
    store.set('smsNotificationSettingsByUser', nextSettingsByUser);
    return normalizedLegacySettings;
}

/** Persists one operator's encrypted SMS settings. */
export function setStoredSmsNotificationSettingsForUser(
    store: AppStore,
    operatorName: string,
    settings: StoredSmsNotificationSettings
) {
    const normalizedOperatorName = normalizeSmsSettingsUserKey(operatorName);
    const nextSettingsByUser = {
        ...normalizeStoredSmsNotificationSettingsByUser(store.get('smsNotificationSettingsByUser')),
        [normalizedOperatorName]: normalizeStoredSmsNotificationSettings(settings)
    };

    store.set('smsNotificationSettingsByUser', nextSettingsByUser);
}
