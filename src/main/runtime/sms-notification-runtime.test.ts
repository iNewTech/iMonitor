import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SMS_NOTIFICATION_SETTINGS } from '../../features/notifications/sms-notification';
import { createSmsNotificationRuntime } from './sms-notification-runtime';

describe('sms-notification-runtime', () => {
    it('renders a provider-defined JSON request and authentication header', async () => {
        const recordActivity = vi.fn();
        const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
            expect(url).toBe('https://api.example.test/messages');
            expect(init?.method).toBe('POST');
            expect(init?.headers).toEqual({
                'X-Tenant': 'operations',
                'Content-Type': 'application/json',
                'X-API-Key': 'secret'
            });
            expect(JSON.parse(String(init?.body))).toEqual({
                destination: '+15550001',
                text: expect.stringContaining('MSGW detected'),
                incident: 'msgw:1'
            });
            return new Response(JSON.stringify({ message: { id: 'provider-123' } }), { status: 202 });
        });

        const runtime = createSmsNotificationRuntime({
            getSettings: () => ({
                ...DEFAULT_SMS_NOTIFICATION_SETTINGS,
                enabled: true,
                providerName: 'Operations gateway',
                endpoint: 'https://api.example.test/messages',
                authType: 'apiKey',
                apiKey: 'secret',
                recipients: '+15550001',
                responseIdPath: 'message.id',
                requestBodyTemplate: '{"destination":"{{recipient}}","text":"{{message}}","incident":"{{alertId}}"}',
                customHeaders: '{"X-Tenant":"operations"}'
            }),
            getConnectionLabel: () => 'Demo connection',
            getOperatorName: () => 'operator',
            cooldownMs: 120000,
            recordActivity,
            fetchImpl: fetchImpl as typeof fetch
        });

        const result = await runtime.sendAlert({
            key: 'msgw:1',
            title: 'MSGW detected',
            body: 'QINTER is waiting for an operator reply.',
            timestamp: '2026-09-03T10:00:00.000Z',
            alertId: 'msgw:1'
        });

        expect(result.success).toBe(true);
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        expect(recordActivity).toHaveBeenCalledWith(expect.objectContaining({
            message: 'Sent alert to SMS provider.',
            detail: expect.stringContaining('provider-123')
        }));
    });

    it('supports form-encoded requests and does not require the channel toggle for a test send', async () => {
        const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
            expect(init?.headers).toEqual({ 'Content-Type': 'application/x-www-form-urlencoded' });
            expect(init?.body).toContain('to=%2B15550001');
            expect(init?.body).toContain('message=');
            return new Response('accepted', { status: 200 });
        });

        const runtime = createSmsNotificationRuntime({
            getSettings: () => ({
                ...DEFAULT_SMS_NOTIFICATION_SETTINGS,
                enabled: false,
                endpoint: 'https://api.example.test/send',
                recipients: '+15550001, +15550002',
                bodyFormat: 'form',
                requestBodyTemplate: 'to={{recipient}}&message={{message}}'
            }),
            getConnectionLabel: () => 'Demo connection',
            cooldownMs: 120000,
            recordActivity: vi.fn(),
            fetchImpl: fetchImpl as typeof fetch
        });

        const result = await runtime.sendTestSms();
        expect(result.success).toBe(true);
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('rejects insecure non-local endpoints', async () => {
        const runtime = createSmsNotificationRuntime({
            getSettings: () => ({
                ...DEFAULT_SMS_NOTIFICATION_SETTINGS,
                enabled: true,
                endpoint: 'http://api.example.test/send',
                recipients: '+15550001'
            }),
            getConnectionLabel: () => 'Demo connection',
            cooldownMs: 120000,
            recordActivity: vi.fn(),
            fetchImpl: vi.fn() as typeof fetch
        });

        await expect(runtime.sendTestSms()).rejects.toThrow('Use an HTTPS SMS API endpoint');
    });

    it('deduplicates repeated alert sends during the cooldown window', async () => {
        const fetchImpl = vi.fn(async () => new Response('ok', { status: 200 }));
        const runtime = createSmsNotificationRuntime({
            getSettings: () => ({
                ...DEFAULT_SMS_NOTIFICATION_SETTINGS,
                enabled: true,
                endpoint: 'https://api.example.test/send',
                recipients: '+15550001'
            }),
            getConnectionLabel: () => 'Demo connection',
            cooldownMs: 120000,
            recordActivity: vi.fn(),
            fetchImpl: fetchImpl as typeof fetch
        });

        await runtime.sendAlert({ key: 'alert:1', title: 'Test', body: 'One' });
        const repeated = await runtime.sendAlert({ key: 'alert:1', title: 'Test', body: 'Two' });

        expect(fetchImpl).toHaveBeenCalledTimes(1);
        expect(repeated).toMatchObject({ success: false, skipped: true, reason: 'cooldown' });
    });
});
