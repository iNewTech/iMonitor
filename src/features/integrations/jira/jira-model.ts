import type { MonitorAlert } from '../../alerts/alert-model';

/** Per-operator Jira alert delivery settings. */
export interface JiraSettings {
    enabled: boolean;
    baseUrl: string;
    username: string;
    apiToken: string;
    projectKey: string;
    issueType: string;
}

/** Encrypted Jira settings stored by Electron. */
export interface StoredJiraSettings {
    enabled: boolean;
    baseUrl: string;
    username: string;
    encryptedApiToken: string;
    projectKey: string;
    issueType: string;
}

export type StoredJiraSettingsByUser = Record<string, StoredJiraSettings>;

export interface JiraIssueReference {
    id: string;
    key: string;
    url: string;
}

export interface JiraIssuePayload {
    fields: {
        project: { key: string };
        summary: string;
        issuetype: { name: string };
        labels: string[];
        description: {
            type: 'doc';
            version: 1;
            content: Array<{
                type: 'paragraph';
                content: Array<{ type: 'text'; text: string }>;
            }>;
        };
    };
}

export const DEFAULT_JIRA_SETTINGS: JiraSettings = {
    enabled: false,
    baseUrl: '',
    username: '',
    apiToken: '',
    projectKey: '',
    issueType: 'Task'
};

export const DEFAULT_STORED_JIRA_SETTINGS: StoredJiraSettings = {
    enabled: false,
    baseUrl: '',
    username: '',
    encryptedApiToken: '',
    projectKey: '',
    issueType: 'Task'
};

export const DEFAULT_STORED_JIRA_SETTINGS_BY_USER: StoredJiraSettingsByUser = {};

/** Normalizes renderer-facing Jira settings. */
export function normalizeJiraSettings(candidate: Partial<JiraSettings> | undefined): JiraSettings {
    return {
        enabled: Boolean(candidate?.enabled),
        baseUrl: normalizeBaseUrl(candidate?.baseUrl),
        username: String(candidate?.username ?? '').trim(),
        apiToken: String(candidate?.apiToken ?? '').trim(),
        projectKey: String(candidate?.projectKey ?? '').trim().toUpperCase(),
        issueType: String(candidate?.issueType ?? DEFAULT_JIRA_SETTINGS.issueType).trim() || DEFAULT_JIRA_SETTINGS.issueType
    };
}

/** Normalizes encrypted Jira settings read from disk. */
export function normalizeStoredJiraSettings(
    candidate: Partial<StoredJiraSettings> | undefined
): StoredJiraSettings {
    const normalized = normalizeJiraSettings({
        enabled: candidate?.enabled,
        baseUrl: candidate?.baseUrl,
        username: candidate?.username,
        projectKey: candidate?.projectKey,
        issueType: candidate?.issueType
    });

    return {
        enabled: normalized.enabled,
        baseUrl: normalized.baseUrl,
        username: normalized.username,
        encryptedApiToken: String(candidate?.encryptedApiToken ?? '').trim(),
        projectKey: normalized.projectKey,
        issueType: normalized.issueType
    };
}

export function normalizeStoredJiraSettingsByUser(
    candidate: Partial<StoredJiraSettingsByUser> | undefined
): StoredJiraSettingsByUser {
    return Object.fromEntries(
        Object.entries(candidate ?? {}).map(([operatorName, settings]) => [
            normalizeJiraSettingsUserKey(operatorName),
            normalizeStoredJiraSettings(settings)
        ])
    );
}

/** Converts renderer-facing Jira settings to encrypted storage format. */
export function toStoredJiraSettings(
    settings: JiraSettings,
    protectSecret: (value: string) => string
): StoredJiraSettings {
    const normalized = normalizeJiraSettings(settings);
    return {
        enabled: normalized.enabled,
        baseUrl: normalized.baseUrl,
        username: normalized.username,
        encryptedApiToken: normalized.apiToken ? protectSecret(normalized.apiToken) : '',
        projectKey: normalized.projectKey,
        issueType: normalized.issueType
    };
}

/** Converts encrypted Jira settings to renderer-facing settings. */
export function toRenderableJiraSettings(
    settings: StoredJiraSettings,
    revealSecret: (value: string) => string
): JiraSettings {
    const normalized = normalizeStoredJiraSettings(settings);
    return {
        enabled: normalized.enabled,
        baseUrl: normalized.baseUrl,
        username: normalized.username,
        apiToken: normalized.encryptedApiToken ? revealSecret(normalized.encryptedApiToken) : '',
        projectKey: normalized.projectKey,
        issueType: normalized.issueType
    };
}

export function normalizeJiraSettingsUserKey(candidate: string | undefined) {
    return String(candidate ?? '').trim() || 'local-operator';
}

/** Builds a Jira Cloud REST API issue request from a newly created alert. */
export function buildJiraIssuePayload(alert: MonitorAlert, settings: JiraSettings): JiraIssuePayload {
    const jobName = alert.jobName || 'No job attached';
    const lines = [
        `Alert: ${alert.title}`,
        `Severity: ${alert.severity.toUpperCase()}`,
        `Job: ${jobName}`,
        `Detected: ${alert.timestamp}`,
        `Incident ID: ${alert.id}`,
        `Message: ${alert.message}`,
        alert.detail ? `Details: ${alert.detail}` : ''
    ].filter(Boolean);

    return {
        fields: {
            project: { key: settings.projectKey },
            summary: `[iMonitor] ${alert.title} · ${jobName}`.slice(0, 255),
            issuetype: { name: settings.issueType },
            labels: ['imonitor', 'ibmeye', alert.kind.toLowerCase()],
            description: {
                type: 'doc',
                version: 1,
                content: [{
                    type: 'paragraph',
                    content: [{ type: 'text', text: lines.join('\n') }]
                }]
            }
        }
    };
}

function normalizeBaseUrl(candidate: string | undefined) {
    return String(candidate ?? '').trim().replace(/\/+$/, '');
}
