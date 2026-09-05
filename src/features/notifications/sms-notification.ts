/**
 * Provider-neutral SMS settings. The Custom HTTP API adapter uses these
 * fields to speak to most REST-based SMS gateways without vendor-specific UI.
 */
export type SmsHttpMethod = 'POST' | 'PUT' | 'PATCH' | 'GET';
export type SmsAuthType = 'none' | 'bearer' | 'apiKey' | 'basic';
export type SmsBodyFormat = 'json' | 'form' | 'text' | 'none';

export interface SmsNotificationSettings {
    enabled: boolean;
    providerName: string;
    endpoint: string;
    method: SmsHttpMethod;
    authType: SmsAuthType;
    apiKey: string;
    apiKeyHeader: string;
    username: string;
    password: string;
    recipients: string;
    bodyFormat: SmsBodyFormat;
    requestBodyTemplate: string;
    customHeaders: string;
    responseIdPath: string;
}

export interface StoredSmsNotificationSettings {
    enabled: boolean;
    providerName: string;
    endpoint: string;
    method: SmsHttpMethod;
    authType: SmsAuthType;
    encryptedApiKey: string;
    apiKeyHeader: string;
    username: string;
    encryptedPassword: string;
    recipients: string;
    bodyFormat: SmsBodyFormat;
    requestBodyTemplate: string;
    customHeaders: string;
    responseIdPath: string;
}

export type StoredSmsNotificationSettingsByUser = Record<string, StoredSmsNotificationSettings>;

export interface SmsMessage {
    title: string;
    body: string;
    timestamp: string;
    connectionLabel: string;
    alertId?: string;
}

export interface SmsDeliveryResult {
    success: boolean;
    skipped?: boolean;
    reason?: 'disabled' | 'cooldown';
    message?: string;
}

/** Contract implemented by built-in and future SMS provider adapters. */
export interface SmsNotificationProvider {
    canSendAlerts(): boolean;
    sendAlert(payload: {
        key: string;
        title: string;
        body: string;
        timestamp?: string;
        alertId?: string;
    }): Promise<SmsDeliveryResult>;
    sendTestSms(): Promise<SmsDeliveryResult>;
}

export const DEFAULT_SMS_NOTIFICATION_SETTINGS: SmsNotificationSettings = {
    enabled: false,
    providerName: '',
    endpoint: '',
    method: 'POST',
    authType: 'none',
    apiKey: '',
    apiKeyHeader: 'X-API-Key',
    username: '',
    password: '',
    recipients: '',
    bodyFormat: 'json',
    requestBodyTemplate: '{\n  "to": "{{recipient}}",\n  "message": "{{message}}"\n}',
    customHeaders: '{}',
    responseIdPath: ''
};

export const DEFAULT_STORED_SMS_NOTIFICATION_SETTINGS: StoredSmsNotificationSettings = {
    enabled: false,
    providerName: '',
    endpoint: '',
    method: 'POST',
    authType: 'none',
    encryptedApiKey: '',
    apiKeyHeader: 'X-API-Key',
    username: '',
    encryptedPassword: '',
    recipients: '',
    bodyFormat: 'json',
    requestBodyTemplate: DEFAULT_SMS_NOTIFICATION_SETTINGS.requestBodyTemplate,
    customHeaders: '{}',
    responseIdPath: ''
};

export const DEFAULT_STORED_SMS_NOTIFICATION_SETTINGS_BY_USER: StoredSmsNotificationSettingsByUser = {};

function normalizeChoice<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
    return typeof value === 'string' && allowed.includes(value as T) ? value as T : fallback;
}

/** Normalizes renderer-facing SMS settings. */
export function normalizeSmsNotificationSettings(
    candidate: Partial<SmsNotificationSettings> | undefined
): SmsNotificationSettings {
    return {
        enabled: Boolean(candidate?.enabled),
        providerName: String(candidate?.providerName ?? DEFAULT_SMS_NOTIFICATION_SETTINGS.providerName).trim(),
        endpoint: String(candidate?.endpoint ?? DEFAULT_SMS_NOTIFICATION_SETTINGS.endpoint).trim(),
        method: normalizeChoice(candidate?.method, ['POST', 'PUT', 'PATCH', 'GET'], 'POST'),
        authType: normalizeChoice(candidate?.authType, ['none', 'bearer', 'apiKey', 'basic'], 'none'),
        apiKey: String(candidate?.apiKey ?? '').trim(),
        apiKeyHeader: String(candidate?.apiKeyHeader ?? DEFAULT_SMS_NOTIFICATION_SETTINGS.apiKeyHeader).trim()
            || DEFAULT_SMS_NOTIFICATION_SETTINGS.apiKeyHeader,
        username: String(candidate?.username ?? '').trim(),
        password: String(candidate?.password ?? '').trim(),
        recipients: String(candidate?.recipients ?? '').trim(),
        bodyFormat: normalizeChoice(candidate?.bodyFormat, ['json', 'form', 'text', 'none'], 'json'),
        requestBodyTemplate: String(
            candidate?.requestBodyTemplate ?? DEFAULT_SMS_NOTIFICATION_SETTINGS.requestBodyTemplate
        ).trim(),
        customHeaders: String(candidate?.customHeaders ?? DEFAULT_SMS_NOTIFICATION_SETTINGS.customHeaders).trim() || '{}',
        responseIdPath: String(candidate?.responseIdPath ?? '').trim()
    };
}

/** Normalizes encrypted settings read from Electron store. */
export function normalizeStoredSmsNotificationSettings(
    candidate: Partial<StoredSmsNotificationSettings> | undefined
): StoredSmsNotificationSettings {
    const normalized = normalizeSmsNotificationSettings({
        enabled: candidate?.enabled,
        providerName: candidate?.providerName,
        endpoint: candidate?.endpoint,
        method: candidate?.method,
        authType: candidate?.authType,
        apiKeyHeader: candidate?.apiKeyHeader,
        username: candidate?.username,
        recipients: candidate?.recipients,
        bodyFormat: candidate?.bodyFormat,
        requestBodyTemplate: candidate?.requestBodyTemplate,
        customHeaders: candidate?.customHeaders,
        responseIdPath: candidate?.responseIdPath
    });

    return {
        enabled: normalized.enabled,
        providerName: normalized.providerName,
        endpoint: normalized.endpoint,
        method: normalized.method,
        authType: normalized.authType,
        encryptedApiKey: String(candidate?.encryptedApiKey ?? '').trim(),
        apiKeyHeader: normalized.apiKeyHeader,
        username: normalized.username,
        encryptedPassword: String(candidate?.encryptedPassword ?? '').trim(),
        recipients: normalized.recipients,
        bodyFormat: normalized.bodyFormat,
        requestBodyTemplate: normalized.requestBodyTemplate,
        customHeaders: normalized.customHeaders,
        responseIdPath: normalized.responseIdPath
    };
}

/** Normalizes the per-operator SMS settings map. */
export function normalizeStoredSmsNotificationSettingsByUser(
    candidate: Partial<StoredSmsNotificationSettingsByUser> | undefined
): StoredSmsNotificationSettingsByUser {
    return Object.fromEntries(
        Object.entries(candidate ?? {}).map(([operatorName, settings]) => [
            normalizeSmsSettingsUserKey(operatorName),
            normalizeStoredSmsNotificationSettings(settings)
        ])
    );
}

/** Converts editable settings into encrypted on-disk settings. */
export function toStoredSmsNotificationSettings(
    settings: SmsNotificationSettings,
    protectSecret: (value: string) => string
): StoredSmsNotificationSettings {
    const normalized = normalizeSmsNotificationSettings(settings);
    return {
        enabled: normalized.enabled,
        providerName: normalized.providerName,
        endpoint: normalized.endpoint,
        method: normalized.method,
        authType: normalized.authType,
        encryptedApiKey: normalized.apiKey ? protectSecret(normalized.apiKey) : '',
        apiKeyHeader: normalized.apiKeyHeader,
        username: normalized.username,
        encryptedPassword: normalized.password ? protectSecret(normalized.password) : '',
        recipients: normalized.recipients,
        bodyFormat: normalized.bodyFormat,
        requestBodyTemplate: normalized.requestBodyTemplate,
        customHeaders: normalized.customHeaders,
        responseIdPath: normalized.responseIdPath
    };
}

/** Converts encrypted settings into renderer-facing editable settings. */
export function toRenderableSmsNotificationSettings(
    settings: StoredSmsNotificationSettings,
    revealSecret: (value: string) => string
): SmsNotificationSettings {
    const normalized = normalizeStoredSmsNotificationSettings(settings);
    return {
        enabled: normalized.enabled,
        providerName: normalized.providerName,
        endpoint: normalized.endpoint,
        method: normalized.method,
        authType: normalized.authType,
        apiKey: normalized.encryptedApiKey ? revealSecret(normalized.encryptedApiKey) : '',
        apiKeyHeader: normalized.apiKeyHeader,
        username: normalized.username,
        password: normalized.encryptedPassword ? revealSecret(normalized.encryptedPassword) : '',
        recipients: normalized.recipients,
        bodyFormat: normalized.bodyFormat,
        requestBodyTemplate: normalized.requestBodyTemplate,
        customHeaders: normalized.customHeaders,
        responseIdPath: normalized.responseIdPath
    };
}

/** Returns a stable per-operator storage key. */
export function normalizeSmsSettingsUserKey(candidate: string | undefined) {
    return String(candidate ?? '').trim() || 'local-operator';
}

/** Splits comma/newline/semicolon-separated phone numbers into unique values. */
export function parseSmsRecipients(value: string) {
    return Array.from(new Set(
        String(value)
            .split(/[\n,;]+/)
            .map((entry) => entry.trim())
            .filter(Boolean)
    ));
}

/** Returns true when enough settings exist to attempt a configured send. */
export function hasSmsNotificationConfig(settings: SmsNotificationSettings) {
    return Boolean(
        settings.endpoint
        && parseSmsRecipients(settings.recipients).length
        && (settings.bodyFormat === 'none' || settings.requestBodyTemplate)
    );
}

/** Builds a compact alert message suitable for SMS delivery. */
export function buildSmsAlertMessage(payload: SmsMessage) {
    const text = [
        `iMonitor: ${payload.title}`,
        payload.body,
        `System: ${payload.connectionLabel}`,
        payload.alertId ? `Alert: ${payload.alertId}` : ''
    ].filter(Boolean).join(' | ');

    return text.length <= 480 ? text : `${text.slice(0, 479)}…`;
}
