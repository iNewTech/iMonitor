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
    DEFAULT_OBJECT_ANALYSIS_SETTINGS,
    normalizeObjectAnalysisSettings,
    type ObjectAnalysisSettings
} from '../features/object-analysis/model';

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
    objectAnalysisSettings: ObjectAnalysisSettings;
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
            objectAnalysisSettings: DEFAULT_OBJECT_ANALYSIS_SETTINGS,
            themeId: DEFAULT_THEME_ID,
            developmentPlan: 'premium'
        }
    }) as AppStore;
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
