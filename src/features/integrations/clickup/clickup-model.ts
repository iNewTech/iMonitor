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
    userEmail: string;
    memberId: string;
    assigneeUserId: string;
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
    userEmail: string;
    memberId: string;
    assigneeUserId: string;
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
    syncComments: true,
    userEmail: '',
    memberId: '',
    assigneeUserId: ''
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
    syncComments: true,
    userEmail: '',
    memberId: '',
    assigneeUserId: ''
};

export const DEFAULT_STORED_CLICKUP_SETTINGS_BY_USER: StoredClickUpSettingsByUser = {};

function normalizeSharedSettings(candidate: Partial<ClickUpSettings> | Partial<StoredClickUpSettings> | undefined) {
    const directMemberId = String(candidate?.memberId ?? '').trim();
    const legacyAssigneeUserId = String(candidate?.assigneeUserId ?? '').trim();
    const memberId = [directMemberId, legacyAssigneeUserId].find((value) => /^\d+$/.test(value)) || '';
    const configuredEmail = String(candidate?.userEmail ?? '').trim();
    const legacyEmail = [directMemberId, legacyAssigneeUserId].find((value) => value.includes('@')) || '';

    return {
        enabled: Boolean(candidate?.enabled),
        workspaceId: String(candidate?.workspaceId ?? '').trim(),
        workspaceName: String(candidate?.workspaceName ?? '').trim(),
        spaceId: String(candidate?.spaceId ?? '').trim(),
        spaceName: String(candidate?.spaceName ?? '').trim(),
        listId: String(candidate?.listId ?? '').trim(),
        listName: String(candidate?.listName ?? '').trim(),
        syncComments: candidate?.syncComments ?? DEFAULT_CLICKUP_SETTINGS.syncComments,
        userEmail: configuredEmail || legacyEmail,
        memberId,
        assigneeUserId: memberId
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
 * Matches the configured ClickUp user email to a ClickUp member id.
 */
export function matchClickUpUserByEmail(
    userEmail: string | undefined,
    users: Array<{
        id?: string | number;
        username?: string;
        email?: string;
        first_name?: string;
        last_name?: string;
    }> | undefined
) {
    const normalizedEmail = String(userEmail ?? '').trim().toLowerCase();
    if (!normalizedEmail || !Array.isArray(users)) {
        return undefined;
    }

    const match = users.find((user) => (
        String(user.email ?? '').trim().toLowerCase() === normalizedEmail
        || String(user.username ?? '').trim().toLowerCase() === normalizedEmail
    ));

    return match?.id ? String(match.id) : undefined;
}

/**
 * Tries to match the current app operator to a ClickUp member by username/email.
 */
export function matchClickUpUserForOperator(
    operatorName: string | undefined,
    users: Array<{
        id?: string | number;
        username?: string;
        email?: string;
        first_name?: string;
        last_name?: string;
    }> | undefined
) {
    const normalizedOperator = normalizeClickUpSettingsUserKey(operatorName).toLowerCase();
    if (!normalizedOperator || !Array.isArray(users)) {
        return undefined;
    }

    const normalizeText = (value: string | undefined) => String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');

    const operatorKey = normalizeText(normalizedOperator);
    const matches = users.filter((user) => {
        const candidateKeys = [
            normalizeText(user.username),
            normalizeText(user.email),
            normalizeText(user.email?.split('@')[0]),
            normalizeText(user.first_name),
            normalizeText(user.last_name),
            normalizeText(`${user.first_name || ''} ${user.last_name || ''}`)
        ].filter(Boolean);

        return candidateKeys.some((candidateKey) => {
            if (!candidateKey) {
                return false;
            }

            return candidateKey === operatorKey
                || operatorKey === candidateKey
                || candidateKey.startsWith(operatorKey)
                || candidateKey.endsWith(operatorKey)
                || operatorKey.startsWith(candidateKey)
                || operatorKey.endsWith(candidateKey)
                || operatorKey.includes(candidateKey)
                || candidateKey.includes(operatorKey);
        });
    });

    return matches[0]?.id ? String(matches[0].id) : undefined;
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
