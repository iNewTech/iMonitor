import { describe, expect, it } from 'vitest';
import {
    DEFAULT_SMS_NOTIFICATION_SETTINGS,
    DEFAULT_STORED_SMS_NOTIFICATION_SETTINGS,
    buildSmsAlertMessage,
    normalizeSmsNotificationSettings,
    parseSmsRecipients,
    toRenderableSmsNotificationSettings,
    toStoredSmsNotificationSettings
} from './sms-notification';

describe('sms-notification model', () => {
    it('normalizes provider settings and preserves a usable JSON template', () => {
        const settings = normalizeSmsNotificationSettings({
            endpoint: ' https://api.example.test/messages ',
            recipients: ' +15550001, +15550001\n+15550002 ',
            authType: 'apiKey',
            apiKeyHeader: ' ',
            requestBodyTemplate: ' {"to":"{{recipient}}"} '
        });

        expect(settings.endpoint).toBe('https://api.example.test/messages');
        expect(settings.apiKeyHeader).toBe('X-API-Key');
        expect(parseSmsRecipients(settings.recipients)).toEqual(['+15550001', '+15550002']);
        expect(settings.requestBodyTemplate).toBe('{"to":"{{recipient}}"}');
    });

    it('encrypts secrets for storage and restores them for the settings form', () => {
        const settings = {
            ...DEFAULT_SMS_NOTIFICATION_SETTINGS,
            apiKey: 'secret-api-key',
            password: 'secret-password'
        };
        const stored = toStoredSmsNotificationSettings(settings, (value) => `safe:${value}`);

        expect(stored.encryptedApiKey).toBe('safe:secret-api-key');
        expect(stored.encryptedPassword).toBe('safe:secret-password');
        expect(toRenderableSmsNotificationSettings(stored, (value) => value.replace(/^safe:/, ''))).toMatchObject({
            apiKey: 'secret-api-key',
            password: 'secret-password'
        });
        expect(DEFAULT_STORED_SMS_NOTIFICATION_SETTINGS.encryptedApiKey).toBe('');
    });

    it('keeps alert text compact enough for a short notification', () => {
        const message = buildSmsAlertMessage({
            title: 'High CPU detected',
            body: 'x'.repeat(1000),
            timestamp: '2026-09-03T10:00:00.000Z',
            connectionLabel: 'Demo connection',
            alertId: 'highCpu:1'
        });

        expect(message.length).toBe(480);
        expect(message.endsWith('…')).toBe(true);
    });
});
