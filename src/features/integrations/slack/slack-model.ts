import type { MonitorAlert } from '../../alerts/alert-model';

/**
 * Per-operator Slack channel delivery settings.
 */
export interface SlackSettings {
    enabled: boolean;
    webhookUrl: string;
    channelName: string;
}

/**
 * Encrypted Slack settings stored by Electron.
 */
export interface StoredSlackSettings {
    enabled: boolean;
    encryptedWebhookUrl: string;
    channelName: string;
}

export type StoredSlackSettingsByUser = Record<string, StoredSlackSettings>;

export interface SlackWebhookPayload {
    text: string;
    attachments: Array<{
        color: string;
        blocks: Array<Record<string, unknown>>;
    }>;
}

export const DEFAULT_SLACK_SETTINGS: SlackSettings = {
    enabled: false,
    webhookUrl: '',
    channelName: ''
};

export const DEFAULT_STORED_SLACK_SETTINGS: StoredSlackSettings = {
    enabled: false,
    encryptedWebhookUrl: '',
    channelName: ''
};

export const DEFAULT_STORED_SLACK_SETTINGS_BY_USER: StoredSlackSettingsByUser = {};

/**
 * Normalizes the encrypted Slack settings map used for per-operator storage.
 */
export function normalizeStoredSlackSettingsByUser(
    candidate: Partial<StoredSlackSettingsByUser> | undefined
): StoredSlackSettingsByUser {
    return Object.fromEntries(
        Object.entries(candidate ?? {}).map(([operatorName, settings]) => [
            normalizeSlackSettingsUserKey(operatorName),
            normalizeStoredSlackSettings(settings)
        ])
    );
}

/**
 * Normalizes renderer-facing Slack settings.
 */
export function normalizeSlackSettings(candidate: Partial<SlackSettings> | undefined): SlackSettings {
    return {
        enabled: Boolean(candidate?.enabled),
        webhookUrl: String(candidate?.webhookUrl ?? '').trim(),
        channelName: String(candidate?.channelName ?? '').trim()
    };
}

/**
 * Normalizes encrypted Slack settings read from disk.
 */
export function normalizeStoredSlackSettings(
    candidate: Partial<StoredSlackSettings> | undefined
): StoredSlackSettings {
    const normalized = normalizeSlackSettings({
        enabled: candidate?.enabled,
        channelName: candidate?.channelName
    });
    return {
        enabled: normalized.enabled,
        encryptedWebhookUrl: String(candidate?.encryptedWebhookUrl ?? '').trim(),
        channelName: normalized.channelName
    };
}

/**
 * Converts Slack settings into the encrypted on-disk format.
 */
export function toStoredSlackSettings(
    settings: SlackSettings,
    protectSecret: (value: string) => string
): StoredSlackSettings {
    const normalized = normalizeSlackSettings(settings);
    return {
        enabled: normalized.enabled,
        encryptedWebhookUrl: normalized.webhookUrl ? protectSecret(normalized.webhookUrl) : '',
        channelName: normalized.channelName
    };
}

/**
 * Converts encrypted Slack settings into renderer-facing settings.
 */
export function toRenderableSlackSettings(
    settings: StoredSlackSettings,
    revealSecret: (value: string) => string
): SlackSettings {
    const normalized = normalizeStoredSlackSettings(settings);
    return {
        enabled: normalized.enabled,
        webhookUrl: normalized.encryptedWebhookUrl ? revealSecret(normalized.encryptedWebhookUrl) : '',
        channelName: normalized.channelName
    };
}

/**
 * Normalizes the user key used to partition Slack settings.
 */
export function normalizeSlackSettingsUserKey(candidate: string | undefined) {
    return String(candidate ?? '').trim() || 'local-operator';
}

/**
 * Builds a concise Slack message for a newly detected alert.
 */
export function buildSlackAlertMessage(alert: MonitorAlert) {
    return [
        `iMonitor alert: ${alert.title}`,
        `Severity: ${alert.severity.toUpperCase()}`,
        `Job: ${alert.jobName || 'N/A'}`,
        `Detected: ${alert.timestamp}`,
        '',
        alert.message,
        alert.detail || '',
        '',
        `Incident: ${alert.id}`
    ].filter(Boolean).join('\n');
}

function escapeSlackText(value: string | undefined) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function truncateSlackText(value: string | undefined, maxLength: number) {
    const normalized = escapeSlackText(value).trim();
    return normalized.length > maxLength
        ? `${normalized.slice(0, maxLength - 1)}…`
        : normalized;
}

function getSlackAlertColor(alert: MonitorAlert) {
    if (alert.severity === 'critical') {
        return '#C9433A';
    }
    if (alert.severity === 'warning') {
        return '#D58A22';
    }
    return '#2C8176';
}

/**
 * Builds one visually distinct Slack card for a newly detected alert.
 */
export function buildSlackAlertPayload(alert: MonitorAlert): SlackWebhookPayload {
    const jobName = truncateSlackText(alert.jobName || 'N/A', 250);
    const detail = truncateSlackText(alert.detail, 1200);
    const blocks: Array<Record<string, unknown>> = [
        {
            type: 'header',
            text: {
                type: 'plain_text',
                text: truncateSlackText(`IBMEye · ${alert.title}`, 150),
                emoji: true
            }
        },
        {
            type: 'section',
            fields: [
                {
                    type: 'mrkdwn',
                    text: `*Severity*\n${escapeSlackText(alert.severity.toUpperCase())}`
                },
                {
                    type: 'mrkdwn',
                    text: `*Job*\n${jobName}`
                }
            ]
        },
        {
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: `*What happened*\n${truncateSlackText(alert.message, 1200)}`
            }
        }
    ];

    if (detail) {
        blocks.push({
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: `*Details*\n${detail}`
            }
        });
    }

    blocks.push({
        type: 'context',
        elements: [
            {
                type: 'mrkdwn',
                text: `Detected ${escapeSlackText(alert.timestamp)}  •  Incident \`${escapeSlackText(alert.id)}\``
            }
        ]
    });

    return {
        text: `IBMEye alert: ${alert.title} | ${alert.severity.toUpperCase()} | ${alert.jobName || 'N/A'}`,
        attachments: [{
            color: getSlackAlertColor(alert),
            blocks
        }]
    };
}
