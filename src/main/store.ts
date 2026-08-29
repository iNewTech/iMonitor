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
import { DEFAULT_THEME_ID, normalizeThemeId, type ThemeId } from '../features/theme/theme-model';
import type { StoredConnection } from '../utils/connections';
import type { StoredAlertWorkflowState } from '../features/alerts/alert-model';

export interface StoreSchema {
    connections: StoredConnection[];
    alertSettings: AlertSettings;
    emailNotificationSettings: StoredEmailNotificationSettings;
    aiAssistantSettings: StoredAiAssistantSettings;
    clickUpSettingsByUser: StoredClickUpSettingsByUser;
    clickUpSettings: StoredClickUpSettings;
    alertWorkflowState: Record<string, StoredAlertWorkflowState>;
    themeId: ThemeId;
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
            alertWorkflowState: {},
            themeId: DEFAULT_THEME_ID
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
