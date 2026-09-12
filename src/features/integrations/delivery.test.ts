import { describe, expect, it, vi } from 'vitest';
import {
    buildDeliveryEventKey,
    createDeliveryRegistry,
    sanitizeDeliveryError
} from './delivery';

describe('integration delivery registry', () => {
    it('creates stable keys for the same incident occurrence', () => {
        expect(buildDeliveryEventKey('jira', 'incident-created', 'lckw:system/job', 2))
            .toBe('jira:incident-created:lckw%3Asystem%2Fjob:2');
        expect(buildDeliveryEventKey('jira', 'incident-created', 'lckw:system/job', 2))
            .toBe(buildDeliveryEventKey('jira', 'incident-created', 'lckw:system/job', 2));
    });

    it('suppresses duplicate sends and persists the successful state', async () => {
        const persist = vi.fn();
        const send = vi.fn(async () => 'external-42');
        const registry = createDeliveryRegistry({}, persist, { retryDelayMs: 0 });

        await expect(registry.deliver('jira', 'jira:event:1', send)).resolves.toEqual({
            state: 'sent',
            attempts: 1,
            value: 'external-42'
        });
        await expect(registry.deliver('jira', 'jira:event:1', send)).resolves.toEqual({
            state: 'duplicate',
            attempts: 1
        });

        expect(send).toHaveBeenCalledTimes(1);
        expect(registry.get('jira:event:1')).toEqual(expect.objectContaining({
            provider: 'jira',
            state: 'sent',
            attempts: 1
        }));
        expect(persist).toHaveBeenCalled();
    });

    it('retries a transient failure and records the final attempt count', async () => {
        const send = vi.fn()
            .mockRejectedValueOnce(new Error('temporary gateway failure'))
            .mockResolvedValueOnce('ok');
        const registry = createDeliveryRegistry({}, vi.fn(), {
            maxAttempts: 2,
            retryDelayMs: 0
        });

        await expect(registry.deliver('slack', 'slack:event:1', send)).resolves.toEqual({
            state: 'sent',
            attempts: 2,
            value: 'ok'
        });
        expect(send).toHaveBeenCalledTimes(2);
        expect(registry.get('slack:event:1')).toEqual(expect.objectContaining({
            state: 'sent',
            attempts: 2
        }));
    });

    it('sanitizes provider errors and records an unavailable delivery', async () => {
        const registry = createDeliveryRegistry({}, vi.fn(), { retryDelayMs: 0 });
        const result = await registry.deliver(
            'clickup',
            'clickup:event:1',
            async () => { throw new Error('Bearer super-secret-token password=hidden'); }
        );

        expect(result).toMatchObject({ state: 'failed', attempts: 2 });
        expect(result.error).not.toContain('super-secret-token');
        expect(result.error).not.toContain('hidden');
        expect(registry.get('clickup:event:1')).toEqual(expect.objectContaining({
            state: 'failed',
            error: expect.not.stringContaining('super-secret-token')
        }));
    });

    it('records a policy skip without attempting delivery', () => {
        const registry = createDeliveryRegistry({}, vi.fn());
        expect(registry.skip('email', 'email:event:1', 'Provider disabled by customer policy')).toEqual({
            state: 'skipped',
            attempts: 0,
            reason: 'Provider disabled by customer policy'
        });
        expect(registry.get('email:event:1')).toEqual(expect.objectContaining({
            state: 'skipped',
            reason: 'Provider disabled by customer policy'
        }));
    });

    it('keeps provider deliveries independent when one adapter is unavailable', async () => {
        const registry = createDeliveryRegistry({}, vi.fn(), { retryDelayMs: 0 });
        const [failed, sent] = await Promise.all([
            registry.deliver('jira', 'jira:event:2', async () => {
                throw new Error('Jira unavailable');
            }),
            registry.deliver('slack', 'slack:event:2', async () => 'sent')
        ]);

        expect(failed.state).toBe('failed');
        expect(sent).toMatchObject({ state: 'sent', value: 'sent' });
        expect(registry.get('jira:event:2')?.state).toBe('failed');
        expect(registry.get('slack:event:2')?.state).toBe('sent');
    });

    it('limits error text stored in the local delivery ledger', () => {
        expect(sanitizeDeliveryError(new Error('x'.repeat(400)))).toHaveLength(240);
    });
});
