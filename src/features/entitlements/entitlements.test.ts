import { describe, expect, it } from 'vitest';
import {
    createEntitlementState,
    DEVELOPMENT_LICENSE_KEY,
    hasEntitlement,
    premiumRequiredMessage
} from './entitlements';

describe('entitlements', () => {
    it('keeps information and desktop notifications free', () => {
        const state = createEntitlementState({ development: false });
        expect(state.plan).toBe('free');
        expect(hasEntitlement(state, 'job-information')).toBe(true);
        expect(hasEntitlement(state, 'desktop-notifications')).toBe(true);
        expect(hasEntitlement(state, 'job-actions')).toBe(false);
    });

    it('enables Premium with the development license only in development', () => {
        const state = createEntitlementState({ development: true, licenseKey: DEVELOPMENT_LICENSE_KEY });
        expect(state.plan).toBe('premium');
        expect(state.source).toBe('development-license');
        expect(hasEntitlement(state, 'clickup-integration')).toBe(true);
        expect(createEntitlementState({ development: false, licenseKey: DEVELOPMENT_LICENSE_KEY }).plan).toBe('free');
    });

    it('supports a free-mode preview in development', () => {
        const state = createEntitlementState({ development: true, forceFree: true, developmentPlan: 'premium' });
        expect(state.plan).toBe('free');
        expect(premiumRequiredMessage('job-actions')).toContain('Premium');
    });

    it('supports explicit Free and Premium development plan previews', () => {
        expect(createEntitlementState({ development: true, developmentPlan: 'free' }).plan).toBe('free');
        expect(createEntitlementState({ development: true, developmentPlan: 'premium' }).plan).toBe('premium');
    });
});
