import nodemailer from 'nodemailer';
import {
    buildAlertEmailMessage,
    buildDisconnectEmailMessage,
    hasEmailNotificationConfig,
    parseEmailRecipients,
    type EmailNotificationSettings
} from '../../features/notifications/email-notification';

interface EmailNotificationRuntimeDependencies {
    appName: string;
    cooldownMs: number;
    getSettings: () => EmailNotificationSettings;
    getConnectionLabel: () => string;
    recordActivity: (entry: {
        area: 'connection' | 'monitoring' | 'storage';
        level: 'info' | 'success' | 'warning' | 'error';
        message: string;
        detail?: string;
    }) => void;
}

/**
 * Sends alert and disconnect emails with SMTP-backed delivery and cooldown protection.
 */
export function createEmailNotificationRuntime(dependencies: EmailNotificationRuntimeDependencies) {
    const ledger = new Map<string, number>();

    const getTransportConfig = (settings: EmailNotificationSettings) => ({
        host: settings.smtpHost,
        port: settings.smtpPort,
        secure: settings.secure,
        auth: settings.username
            ? {
                user: settings.username,
                pass: settings.password
            }
            : undefined
    });

    const ensureConfig = (settings: EmailNotificationSettings) => {
        if (!hasEmailNotificationConfig(settings)) {
            throw new Error(
                'Email notifications are not fully configured. Set SMTP host, sender, and at least one recipient.'
            );
        }
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

    const sendMessage = async (
        key: string,
        emailMessage: { subject: string; text: string; },
        successMessage: string
    ) => {
        const settings = dependencies.getSettings();
        if (!settings.enabled) {
            return { success: false, skipped: true as const, reason: 'disabled' as const };
        }

        ensureConfig(settings);
        if (!shouldSend(key)) {
            return { success: false, skipped: true as const, reason: 'cooldown' as const };
        }

        const transporter = nodemailer.createTransport(getTransportConfig(settings));
        await transporter.sendMail({
            from: settings.fromAddress,
            to: parseEmailRecipients(settings.toAddresses),
            subject: emailMessage.subject,
            text: emailMessage.text
        });

        dependencies.recordActivity({
            area: 'connection',
            level: 'success',
            message: successMessage,
            detail: `Recipients: ${parseEmailRecipients(settings.toAddresses).join(', ')}`
        });

        return { success: true };
    };

    return {
        async sendAlertEmail(payload: { key: string; title: string; body: string; timestamp?: string; }) {
            return sendMessage(
                `alert:${payload.key}`,
                buildAlertEmailMessage({
                    title: payload.title,
                    body: payload.body,
                    timestamp: payload.timestamp ?? new Date().toISOString(),
                    connectionLabel: dependencies.getConnectionLabel()
                }),
                `Sent alert email for ${payload.title}.`
            );
        },
        async sendDisconnectEmail(timestamp = new Date().toISOString()) {
            return sendMessage(
                'disconnect',
                buildDisconnectEmailMessage({
                    timestamp,
                    connectionLabel: dependencies.getConnectionLabel()
                }),
                'Sent disconnect email notification.'
            );
        },
        async sendTestEmail() {
            const settings = dependencies.getSettings();
            ensureConfig(settings);

            const transporter = nodemailer.createTransport(getTransportConfig(settings));
            await transporter.sendMail({
                from: settings.fromAddress,
                to: parseEmailRecipients(settings.toAddresses),
                subject: `[${dependencies.appName}] Test email notification`,
                text: [
                    `${dependencies.appName} test email`,
                    `Time: ${new Date().toISOString()}`,
                    `Connection: ${dependencies.getConnectionLabel()}`,
                    '',
                    'This confirms that SMTP email delivery is working from IBMEye.'
                ].join('\n')
            });

            dependencies.recordActivity({
                area: 'connection',
                level: 'success',
                message: 'Sent test email notification.',
                detail: `Recipients: ${parseEmailRecipients(settings.toAddresses).join(', ')}`
            });

            return { success: true };
        }
    };
}
