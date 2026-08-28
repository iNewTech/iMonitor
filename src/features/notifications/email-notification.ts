export interface EmailNotificationSettings {
    enabled: boolean;
    smtpHost: string;
    smtpPort: number;
    secure: boolean;
    username: string;
    password: string;
    fromAddress: string;
    toAddresses: string;
}

export interface StoredEmailNotificationSettings {
    enabled: boolean;
    smtpHost: string;
    smtpPort: number;
    secure: boolean;
    username: string;
    encryptedPassword: string;
    fromAddress: string;
    toAddresses: string;
}

export interface EmailMessage {
    subject: string;
    text: string;
}

export const DEFAULT_EMAIL_NOTIFICATION_SETTINGS: EmailNotificationSettings = {
    enabled: false,
    smtpHost: '',
    smtpPort: 587,
    secure: false,
    username: '',
    password: '',
    fromAddress: '',
    toAddresses: ''
};

export const DEFAULT_STORED_EMAIL_NOTIFICATION_SETTINGS: StoredEmailNotificationSettings = {
    enabled: false,
    smtpHost: '',
    smtpPort: 587,
    secure: false,
    username: '',
    encryptedPassword: '',
    fromAddress: '',
    toAddresses: ''
};

/**
 * Normalizes user-editable email delivery settings.
 */
export function normalizeEmailNotificationSettings(
    candidate: Partial<EmailNotificationSettings> | undefined
): EmailNotificationSettings {
    const nextPort = Number(candidate?.smtpPort);

    return {
        enabled: candidate?.enabled ?? DEFAULT_EMAIL_NOTIFICATION_SETTINGS.enabled,
        smtpHost: String(candidate?.smtpHost ?? DEFAULT_EMAIL_NOTIFICATION_SETTINGS.smtpHost).trim(),
        smtpPort: Number.isFinite(nextPort)
            ? Math.max(1, Math.min(65535, nextPort))
            : DEFAULT_EMAIL_NOTIFICATION_SETTINGS.smtpPort,
        secure: candidate?.secure ?? DEFAULT_EMAIL_NOTIFICATION_SETTINGS.secure,
        username: String(candidate?.username ?? DEFAULT_EMAIL_NOTIFICATION_SETTINGS.username).trim(),
        password: String(candidate?.password ?? DEFAULT_EMAIL_NOTIFICATION_SETTINGS.password).trim(),
        fromAddress: String(candidate?.fromAddress ?? DEFAULT_EMAIL_NOTIFICATION_SETTINGS.fromAddress).trim(),
        toAddresses: String(candidate?.toAddresses ?? DEFAULT_EMAIL_NOTIFICATION_SETTINGS.toAddresses).trim()
    };
}

/**
 * Normalizes the encrypted email settings persisted in Electron store.
 */
export function normalizeStoredEmailNotificationSettings(
    candidate: Partial<StoredEmailNotificationSettings> | undefined
): StoredEmailNotificationSettings {
    const nextPort = Number(candidate?.smtpPort);

    return {
        enabled: candidate?.enabled ?? DEFAULT_STORED_EMAIL_NOTIFICATION_SETTINGS.enabled,
        smtpHost: String(candidate?.smtpHost ?? DEFAULT_STORED_EMAIL_NOTIFICATION_SETTINGS.smtpHost).trim(),
        smtpPort: Number.isFinite(nextPort)
            ? Math.max(1, Math.min(65535, nextPort))
            : DEFAULT_STORED_EMAIL_NOTIFICATION_SETTINGS.smtpPort,
        secure: candidate?.secure ?? DEFAULT_STORED_EMAIL_NOTIFICATION_SETTINGS.secure,
        username: String(candidate?.username ?? DEFAULT_STORED_EMAIL_NOTIFICATION_SETTINGS.username).trim(),
        encryptedPassword: String(
            candidate?.encryptedPassword ?? DEFAULT_STORED_EMAIL_NOTIFICATION_SETTINGS.encryptedPassword
        ).trim(),
        fromAddress: String(candidate?.fromAddress ?? DEFAULT_STORED_EMAIL_NOTIFICATION_SETTINGS.fromAddress).trim(),
        toAddresses: String(candidate?.toAddresses ?? DEFAULT_STORED_EMAIL_NOTIFICATION_SETTINGS.toAddresses).trim()
    };
}

/**
 * Splits comma or newline-separated email recipients into a unique array.
 */
export function parseEmailRecipients(value: string) {
    return Array.from(new Set(
        String(value)
            .split(/[\n,;]+/)
            .map((entry) => entry.trim())
            .filter(Boolean)
    ));
}

/**
 * Returns true when SMTP settings are complete enough to attempt delivery.
 */
export function hasEmailNotificationConfig(settings: EmailNotificationSettings) {
    return (
        settings.enabled
        && Boolean(settings.smtpHost)
        && Boolean(settings.fromAddress)
        && parseEmailRecipients(settings.toAddresses).length > 0
    );
}

/**
 * Converts decrypted settings to a stored shape by encrypting the SMTP password.
 */
export function toStoredEmailNotificationSettings(
    settings: EmailNotificationSettings,
    protectPassword: (password: string) => string
): StoredEmailNotificationSettings {
    return {
        enabled: settings.enabled,
        smtpHost: settings.smtpHost,
        smtpPort: settings.smtpPort,
        secure: settings.secure,
        username: settings.username,
        encryptedPassword: settings.password ? protectPassword(settings.password) : '',
        fromAddress: settings.fromAddress,
        toAddresses: settings.toAddresses
    };
}

/**
 * Converts stored encrypted settings into a renderer-safe editable shape.
 */
export function toRenderableEmailNotificationSettings(
    settings: StoredEmailNotificationSettings,
    revealPassword: (encryptedPassword: string) => string
): EmailNotificationSettings {
    return {
        enabled: settings.enabled,
        smtpHost: settings.smtpHost,
        smtpPort: settings.smtpPort,
        secure: settings.secure,
        username: settings.username,
        password: settings.encryptedPassword ? revealPassword(settings.encryptedPassword) : '',
        fromAddress: settings.fromAddress,
        toAddresses: settings.toAddresses
    };
}

/**
 * Builds the outbound alert email subject and plain-text body.
 */
export function buildAlertEmailMessage(payload: {
    title: string;
    body: string;
    timestamp: string;
    connectionLabel: string;
}): EmailMessage {
    return {
        subject: `[IBMEye Alerts] ${payload.title}`,
        text: [
            'IBMEye alert',
            `Time: ${payload.timestamp}`,
            `Connection: ${payload.connectionLabel}`,
            '',
            payload.body,
            '',
            'Open iMonitor for full alert history and operator actions.'
        ].join('\n')
    };
}

/**
 * Builds the outbound disconnect email subject and plain-text body.
 */
export function buildDisconnectEmailMessage(payload: {
    timestamp: string;
    connectionLabel: string;
}): EmailMessage {
    return {
        subject: '[iMonitor] Disconnected from IBM i system',
        text: [
            'iMonitor disconnect notification',
            `Time: ${payload.timestamp}`,
            `Connection: ${payload.connectionLabel}`,
            '',
            'The active IBM i monitoring session was disconnected.'
        ].join('\n')
    };
}
