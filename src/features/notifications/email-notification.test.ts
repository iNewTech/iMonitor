import { describe, expect, it } from 'vitest';
import {
    DEFAULT_EMAIL_NOTIFICATION_SETTINGS,
    buildAlertEmailMessage,
    buildDisconnectEmailMessage,
    hasEmailNotificationConfig,
    normalizeEmailNotificationSettings,
    parseEmailRecipients
} from './email-notification';

describe('email notification settings', () => {
    it('normalizes missing values with safe defaults', () => {
        expect(normalizeEmailNotificationSettings(undefined)).toEqual(
            DEFAULT_EMAIL_NOTIFICATION_SETTINGS
        );
    });

    it('clamps SMTP ports and trims identity fields', () => {
        expect(normalizeEmailNotificationSettings({
            enabled: true,
            smtpHost: ' smtp.example.com ',
            smtpPort: 99999,
            secure: true,
            username: ' ops ',
            password: ' secret ',
            fromAddress: ' alerts@example.com ',
            toAddresses: ' one@example.com, two@example.com '
        })).toMatchObject({
            enabled: true,
            smtpHost: 'smtp.example.com',
            smtpPort: 65535,
            secure: true,
            username: 'ops',
            password: 'secret',
            fromAddress: 'alerts@example.com',
            toAddresses: 'one@example.com, two@example.com'
        });
    });

    it('parses unique recipients from comma and newline separated input', () => {
        expect(parseEmailRecipients('one@example.com,\ntwo@example.com\none@example.com')).toEqual([
            'one@example.com',
            'two@example.com'
        ]);
    });

    it('requires a usable SMTP config before delivery is allowed', () => {
        expect(hasEmailNotificationConfig(DEFAULT_EMAIL_NOTIFICATION_SETTINGS)).toBe(false);
        expect(hasEmailNotificationConfig({
            ...DEFAULT_EMAIL_NOTIFICATION_SETTINGS,
            enabled: true,
            smtpHost: 'smtp.example.com',
            smtpPort: 587,
            fromAddress: 'alerts@example.com',
            toAddresses: 'ops@example.com'
        })).toBe(true);
    });

    it('builds readable alert and disconnect email messages', () => {
        const alertMessage = buildAlertEmailMessage({
            title: 'MSGW detected',
            body: 'QINTER/MSGWJOB entered message wait.',
            timestamp: '2026-08-23T18:00:00.000Z',
            connectionLabel: 'Demo System (DEMO@dummy.local:8076)'
        });
        const disconnectMessage = buildDisconnectEmailMessage({
            timestamp: '2026-08-23T18:05:00.000Z',
            connectionLabel: 'Demo System (DEMO@dummy.local:8076)'
        });

        expect(alertMessage.subject).toContain('MSGW detected');
        expect(alertMessage.text).toContain('Demo System');
        expect(disconnectMessage.subject).toContain('Disconnected');
        expect(disconnectMessage.text).toContain('dummy.local:8076');
    });
});
