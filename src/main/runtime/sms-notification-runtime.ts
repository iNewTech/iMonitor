import {
    buildSmsAlertMessage,
    hasSmsNotificationConfig,
    normalizeSmsNotificationSettings,
    parseSmsRecipients,
    type SmsBodyFormat,
    type SmsNotificationSettings
} from '../../features/notifications/sms-notification';

interface SmsNotificationRuntimeDependencies {
    getSettings: () => SmsNotificationSettings;
    getConnectionLabel: () => string;
    getOperatorName?: () => string;
    cooldownMs: number;
    development?: boolean;
    recordActivity: (entry: {
        area: 'connection' | 'monitoring' | 'storage';
        level: 'info' | 'success' | 'warning' | 'error';
        message: string;
        detail?: string;
    }) => void;
    fetchImpl?: typeof fetch;
}

type TemplateContext = Record<string, string>;

function renderTemplateString(template: string, context: TemplateContext) {
    return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, key: string) => context[key] ?? '');
}

function renderJsonTemplate(template: string, context: TemplateContext) {
    let parsed: unknown;
    try {
        parsed = JSON.parse(template);
    } catch {
        throw new Error('The JSON request body template is not valid JSON.');
    }

    const replaceValues = (value: unknown): unknown => {
        if (typeof value === 'string') {
            const exactToken = value.match(/^\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}$/);
            if (exactToken && context[exactToken[1]] !== undefined) {
                return context[exactToken[1]];
            }
            return renderTemplateString(value, context);
        }

        if (Array.isArray(value)) {
            return value.map(replaceValues);
        }

        if (value && typeof value === 'object') {
            return Object.fromEntries(
                Object.entries(value).map(([key, child]) => [key, replaceValues(child)])
            );
        }

        return value;
    };

    return JSON.stringify(replaceValues(parsed));
}

function renderFormTemplate(template: string, context: TemplateContext) {
    return template
        .split('&')
        .filter(Boolean)
        .map((part) => {
            const separator = part.indexOf('=');
            const rawKey = separator >= 0 ? part.slice(0, separator) : part;
            const rawValue = separator >= 0 ? part.slice(separator + 1) : '';
            const key = decodeURIComponent(rawKey.replace(/\+/g, ' '));
            const value = renderTemplateString(decodeURIComponent(rawValue.replace(/\+/g, ' ')), context);
            return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
        })
        .join('&');
}

function parseCustomHeaders(value: string) {
    let parsed: unknown;
    try {
        parsed = JSON.parse(value || '{}');
    } catch {
        throw new Error('Custom headers must be valid JSON.');
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Custom headers must be a JSON object.');
    }

    return Object.fromEntries(Object.entries(parsed).map(([key, headerValue]) => {
        if (!key.trim() || (typeof headerValue !== 'string' && typeof headerValue !== 'number' && typeof headerValue !== 'boolean')) {
            throw new Error('Custom header names and values must be text or simple numbers.');
        }
        if (/[\r\n]/.test(String(headerValue))) {
            throw new Error('Custom header values cannot contain line breaks.');
        }
        return [key.trim(), String(headerValue)];
    }));
}

function getResponseValue(payload: unknown, path: string) {
    if (!path.trim() || !payload || typeof payload !== 'object') {
        return undefined;
    }

    return path.split('.').reduce<unknown>((value, segment) => {
        if (!value || typeof value !== 'object') {
            return undefined;
        }
        return (value as Record<string, unknown>)[segment];
    }, payload);
}

function replaceTemplateTokens(value: string) {
    return value.replace(/\{\{\s*[a-zA-Z0-9_.-]+\s*\}\}/g, 'test');
}

function getRequestBody(settings: SmsNotificationSettings, context: TemplateContext) {
    if (settings.bodyFormat === 'none') {
        return undefined;
    }

    switch (settings.bodyFormat as SmsBodyFormat) {
        case 'json':
            return renderJsonTemplate(settings.requestBodyTemplate, context);
        case 'form':
            return renderFormTemplate(settings.requestBodyTemplate, context);
        case 'text':
            return renderTemplateString(settings.requestBodyTemplate, context);
        default:
            return undefined;
    }
}

/** Sends SMS alerts through a user-configured HTTP API. */
export function createSmsNotificationRuntime(dependencies: SmsNotificationRuntimeDependencies) {
    const fetcher = dependencies.fetchImpl ?? fetch;
    const ledger = new Map<string, number>();

    const getConfiguredSettings = (requireEnabled = true) => {
        const settings = normalizeSmsNotificationSettings(dependencies.getSettings());
        if (requireEnabled && !settings.enabled) {
            throw new Error('SMS notifications are turned off in Settings.');
        }

        if (!hasSmsNotificationConfig(settings)) {
            throw new Error('SMS is not fully configured. Add an endpoint, recipient, and request body template.');
        }

        let endpoint: URL;
        try {
            endpoint = new URL(replaceTemplateTokens(settings.endpoint));
        } catch {
            throw new Error('The SMS API endpoint URL is not valid.');
        }

        const localDevelopmentEndpoint = dependencies.development
            && endpoint.protocol === 'http:'
            && ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname);
        if (endpoint.protocol !== 'https:' && !localDevelopmentEndpoint) {
            throw new Error('Use an HTTPS SMS API endpoint. HTTP is allowed only for localhost in development.');
        }

        if (settings.authType === 'bearer' && !settings.apiKey) {
            throw new Error('Add a bearer token for this SMS API.');
        }
        if (settings.authType === 'apiKey' && !settings.apiKey) {
            throw new Error('Add an API key for this SMS API.');
        }
        if (settings.authType === 'basic' && (!settings.username || !settings.password)) {
            throw new Error('Add both a username and password for Basic authentication.');
        }

        parseCustomHeaders(settings.customHeaders);
        return settings;
    };

    const shouldSend = (key: string) => {
        const previousTimestamp = ledger.get(key) ?? 0;
        const now = Date.now();
        if (now - previousTimestamp < dependencies.cooldownMs) {
            return false;
        }
        ledger.set(key, now);
        return true;
    };

    const sendToRecipient = async (
        settings: SmsNotificationSettings,
        recipient: string,
        message: string,
        metadata: { title: string; body: string; timestamp: string; alertId?: string; }
    ) => {
        const context: TemplateContext = {
            recipient,
            to: recipient,
            message,
            text: message,
            title: metadata.title,
            body: metadata.body,
            timestamp: metadata.timestamp,
            connection: dependencies.getConnectionLabel(),
            operator: dependencies.getOperatorName?.() || 'local operator',
            alertId: metadata.alertId || '',
            apiKey: settings.apiKey,
            username: settings.username,
            password: settings.password
        };
        const headers: Record<string, string> = Object.fromEntries(
            Object.entries(parseCustomHeaders(settings.customHeaders)).map(([key, value]) => [
                key,
                renderTemplateString(value, context)
            ])
        );
        if (!Object.keys(headers).some((key) => key.toLowerCase() === 'content-type') && settings.bodyFormat !== 'none') {
            headers['Content-Type'] = settings.bodyFormat === 'form'
                ? 'application/x-www-form-urlencoded'
                : settings.bodyFormat === 'text'
                    ? 'text/plain'
                    : 'application/json';
        }

        if (settings.authType === 'bearer') {
            headers.Authorization = `Bearer ${settings.apiKey}`;
        } else if (settings.authType === 'apiKey') {
            headers[settings.apiKeyHeader] = settings.apiKey;
        } else if (settings.authType === 'basic') {
            headers.Authorization = `Basic ${Buffer.from(`${settings.username}:${settings.password}`).toString('base64')}`;
        }

        const requestInit: RequestInit = {
            method: settings.method,
            headers
        };
        if (settings.method !== 'GET') {
            requestInit.body = getRequestBody(settings, context);
        }

        const response = await fetcher(renderTemplateString(settings.endpoint, context), requestInit);
        const responseText = await response.text();
        let responsePayload: unknown = responseText;
        try {
            responsePayload = responseText ? JSON.parse(responseText) : undefined;
        } catch {
            // Many SMS APIs return plain text on success.
        }

        if (!response.ok) {
            throw new Error(`SMS API ${response.status}: ${responseText || response.statusText}`);
        }

        const responseId = getResponseValue(responsePayload, settings.responseIdPath);
        return typeof responseId === 'string' || typeof responseId === 'number'
            ? String(responseId)
            : undefined;
    };

    const sendMessage = async (
        key: string,
        payload: SmsMessagePayload,
        requireEnabled = true,
        recipientLimit?: number
    ) => {
        const settings = getConfiguredSettings(requireEnabled);
        const allRecipients = parseSmsRecipients(settings.recipients);
        const recipients = recipientLimit ? allRecipients.slice(0, recipientLimit) : allRecipients;
        const message = buildSmsAlertMessage({
            title: payload.title,
            body: payload.body,
            timestamp: payload.timestamp,
            connectionLabel: dependencies.getConnectionLabel(),
            alertId: payload.alertId
        });
        const sentRecipients: string[] = [];
        const responseIds: string[] = [];

        for (const recipient of recipients) {
            if (requireEnabled && !shouldSend(`${key}:${recipient}`)) {
                continue;
            }
            const responseId = await sendToRecipient(settings, recipient, message, payload);
            sentRecipients.push(recipient);
            if (responseId) responseIds.push(responseId);
        }

        if (!sentRecipients.length) {
            return { success: false, skipped: true as const, reason: 'cooldown' as const };
        }

        dependencies.recordActivity({
            area: 'monitoring',
            level: 'success',
            message: 'Sent alert to SMS provider.',
            detail: `${settings.providerName || 'Custom SMS API'} · ${sentRecipients.join(', ')}${responseIds.length ? ` · ID: ${responseIds.join(', ')}` : ''}`
        });

        return { success: true, message };
    };

    return {
        canSendAlerts() {
            const settings = normalizeSmsNotificationSettings(dependencies.getSettings());
            return Boolean(settings.enabled && hasSmsNotificationConfig(settings));
        },
        async sendAlert(payload: { key: string; title: string; body: string; timestamp?: string; alertId?: string; }) {
            return sendMessage(payload.key, {
                title: payload.title,
                body: payload.body,
                timestamp: payload.timestamp ?? new Date().toISOString(),
                alertId: payload.alertId ?? payload.key
            });
        },
        async sendDisconnectSms() {
            return sendMessage('disconnect', {
                title: 'iMonitor disconnected',
                body: 'The active IBM i session was disconnected.',
                timestamp: new Date().toISOString()
            });
        },
        async sendTestSms() {
            const operator = dependencies.getOperatorName?.() || 'local operator';
            return sendMessage('test', {
                title: 'SMS provider test',
                body: `SMS delivery is configured for ${operator}.`,
                timestamp: new Date().toISOString()
            }, false, 1);
        }
    };
}

interface SmsMessagePayload {
    title: string;
    body: string;
    timestamp: string;
    alertId?: string;
}
