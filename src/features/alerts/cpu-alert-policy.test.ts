import { describe, expect, it } from 'vitest';
import { isCpuAlertEligible, isCpuRecovered } from './cpu-alert-policy';

describe('CPU alert policy', () => {
    it('supports immediate alerts for the current default policy', () => {
        expect(isCpuAlertEligible('2026-08-31T09:00:00.000Z', '2026-08-31T09:00:01.000Z')).toBe(true);
    });

    it('waits for the configured duration before raising an alert', () => {
        expect(isCpuAlertEligible('2026-08-31T09:00:00.000Z', '2026-08-31T09:00:10.000Z', 30)).toBe(false);
        expect(isCpuAlertEligible('2026-08-31T09:00:00.000Z', '2026-08-31T09:00:30.000Z', 30)).toBe(true);
    });

    it('recognizes recovery below the recovery threshold', () => {
        expect(isCpuRecovered(69.9, 70)).toBe(true);
        expect(isCpuRecovered(70, 70)).toBe(false);
    });
});
