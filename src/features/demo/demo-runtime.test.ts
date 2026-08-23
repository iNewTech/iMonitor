import { describe, expect, it } from 'vitest';
import { getDemoAvailability, isDemoRequest } from './demo-runtime';

describe('demo runtime', () => {
    it('enables demo mode in development builds', () => {
        expect(getDemoAvailability(false)).toEqual({ enabled: true });
    });

    it('disables demo mode in packaged builds', () => {
        expect(getDemoAvailability(true)).toEqual({
            enabled: false,
            reason: 'Demo mode is disabled in packaged production builds.'
        });
    });

    it('detects explicit demo requests', () => {
        expect(isDemoRequest({
            host: 'dummy',
            user: 'operator',
            port: 8076,
            mode: 'live',
            password: 'ignored'
        })).toBe(true);

        expect(isDemoRequest({
            host: 'prod-host',
            user: 'dummy',
            port: 8076,
            mode: 'live',
            password: 'ignored'
        })).toBe(true);

        expect(isDemoRequest({
            host: 'prod-host',
            user: 'operator',
            port: 8076,
            mode: 'dummy',
            password: 'ignored'
        })).toBe(true);
    });
});
