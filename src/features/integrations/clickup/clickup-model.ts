export interface ClickUpSettings {
    enabled: boolean;
    apiToken: string;
    workspaceId: string;
    workspaceName: string;
    spaceId: string;
    spaceName: string;
    listId: string;
    listName: string;
    syncComments: boolean;
}

export interface StoredClickUpSettings {
    enabled: boolean;
    encryptedApiToken: string;
    workspaceId: string;
    workspaceName: string;
    spaceId: string;
    spaceName: string;
    listId: string;
    listName: string;
    syncComments: boolean;
}

export type StoredClickUpSettingsByUser = Record<string, StoredClickUpSettings>;

export interface ClickUpWorkspaceOption {
    id: string;
    name: string;
}

export interface ClickUpSpaceOption {
    id: string;
    name: string;
}

export interface ClickUpListOption {
    id: string;
    name: string;
    source: 'folder' | 'folderless';
    folderName?: string;
}

export interface ClickUpTargetOptions {
    workspaces: ClickUpWorkspaceOption[];
    spaces: ClickUpSpaceOption[];
    lists: ClickUpListOption[];
}

export interface ClickUpTaskReference {
    id: string;
    url?: string;
    name?: string;
}

export const DEFAULT_CLICKUP_SETTINGS: ClickUpSettings = {
    enabled: false,
    apiToken: '',
    workspaceId: '',
    workspaceName: '',
    spaceId: '',
    spaceName: '',
    listId: '',
    listName: '',
    syncComments: true
};

export const DEFAULT_STORED_CLICKUP_SETTINGS: StoredClickUpSettings = {
    enabled: false,
    encryptedApiToken: '',
    workspaceId: '',
    workspaceName: '',
    spaceId: '',
    spaceName: '',
    listId: '',
    listName: '',
    syncComments: true
};

export const DEFAULT_STORED_CLICKUP_SETTINGS_BY_USER: StoredClickUpSettingsByUser = {};

function normalizeSharedSettings(candidate: Partial<ClickUpSettings> | Partial<StoredClickUpSettings> | undefined) {
    return {
        enabled: Boolean(candidate?.enabled),
        workspaceId: String(candidate?.workspaceId ?? '').trim(),
        workspaceName: String(candidate?.workspaceName ?? '').trim(),
        spaceId: String(candidate?.spaceId ?? '').trim(),
        spaceName: String(candidate?.spaceName ?? '').trim(),
        listId: String(candidate?.listId ?? '').trim(),
        listName: String(candidate?.listName ?? '').trim(),
        syncComments: candidate?.syncComments ?? DEFAULT_CLICKUP_SETTINGS.syncComments
    };
}

/**
 * Normalizes ClickUp settings used by the renderer.
 */
export function normalizeClickUpSettings(candidate: Partial<ClickUpSettings> | undefined): ClickUpSettings {
    return {
        ...normalizeSharedSettings(candidate),
        apiToken: String(candidate?.apiToken ?? '').trim()
    };
}

/**
 * Normalizes ClickUp settings stored on disk.
 */
export function normalizeStoredClickUpSettings(
    candidate: Partial<StoredClickUpSettings> | undefined
): StoredClickUpSettings {
    return {
        ...normalizeSharedSettings(candidate),
        encryptedApiToken: String(candidate?.encryptedApiToken ?? '').trim()
    };
}

/**
 * Converts renderable ClickUp settings into the encrypted on-disk format.
 */
export function toStoredClickUpSettings(
    settings: ClickUpSettings,
    protectSecret: (value: string) => string
): StoredClickUpSettings {
    const normalized = normalizeClickUpSettings(settings);
    return {
        ...normalized,
        encryptedApiToken: normalized.apiToken ? protectSecret(normalized.apiToken) : ''
    };
}

/**
 * Converts encrypted ClickUp settings into the renderer-facing format.
 */
export function toRenderableClickUpSettings(
    settings: StoredClickUpSettings,
    revealSecret: (value: string) => string
): ClickUpSettings {
    const normalized = normalizeStoredClickUpSettings(settings);
    return {
        ...normalized,
        apiToken: normalized.encryptedApiToken ? revealSecret(normalized.encryptedApiToken) : ''
    };
}

/**
 * Normalizes the user key used to partition saved ClickUp settings.
 */
export function normalizeClickUpSettingsUserKey(candidate: string | undefined) {
    return String(candidate ?? '').trim() || 'local-operator';
}

/**
 * Normalizes the per-user ClickUp settings map stored on disk.
 */
export function normalizeStoredClickUpSettingsByUser(
    candidate: StoredClickUpSettingsByUser | undefined
): StoredClickUpSettingsByUser {
    if (!candidate || typeof candidate !== 'object') {
        return {};
    }

    return Object.entries(candidate).reduce<StoredClickUpSettingsByUser>((nextSettings, [userKey, settings]) => {
        const normalizedUserKey = normalizeClickUpSettingsUserKey(userKey);
        nextSettings[normalizedUserKey] = normalizeStoredClickUpSettings(settings);
        return nextSettings;
    }, {});
}
