import { describe, expect, it } from 'vitest';
import type { MonitorAlert } from '../alerts/alert-model';
import {
    buildRoutingRecommendation,
    isWithinSupportWindow,
    type RoutingOperator
} from './incident-routing';

const alert = {
    id: 'lock-alert',
    timestamp: '2026-09-14T13:00:00.000Z',
    kind: 'lockWait',
    severity: 'critical',
    workflowStatus: 'new'
} as MonitorAlert;

function operator(overrides: Partial<RoutingOperator> = {}): RoutingOperator {
    return {
        operatorId: 'l2-a',
        displayName: 'L2 A',
        systemIds: ['system-1'],
        permissions: ['read', 'investigate'],
        skills: ['lock-investigation'],
        availability: 'available',
        ...overrides
    };
}

describe('incident-routing', () => {
    it('recommends a scoped operator with the required skill and explains the match', () => {
        const result = buildRoutingRecommendation({
            alert,
            systemId: 'system-1',
            now: '2026-09-14T13:05:00.000Z',
            operators: [operator(), operator({
                operatorId: 'read-only',
                displayName: 'Read only',
                permissions: ['read']
            })]
        });

        expect(result.recommendedOperator).toEqual({ operatorId: 'l2-a', displayName: 'L2 A' });
        expect(result.eligibleOperatorCount).toBe(1);
        expect(result.reasons.join(' ')).toContain('lock-investigation');
        expect(result.sla.state).toBe('on_track');
    });

    it('excludes expired access, wrong scope, and missing skills', () => {
        const result = buildRoutingRecommendation({
            alert,
            systemId: 'system-1',
            now: '2026-09-14T13:05:00.000Z',
            operators: [
                operator({ operatorId: 'expired', displayName: 'Expired', expiresAt: '2026-09-14T13:01:00.000Z' }),
                operator({ operatorId: 'other-system', displayName: 'Other system', systemIds: ['system-2'] }),
                operator({ operatorId: 'wrong-skill', displayName: 'Wrong skill', skills: ['performance'] })
            ]
        });

        expect(result.recommendedOperator).toBeUndefined();
        expect(result.eligibleOperatorCount).toBe(0);
        expect(result.escalationReasons.join(' ')).toContain('expired');
        expect(result.reasons[0]).toContain('No eligible operator');
    });

    it('marks an overdue incident and tells the operator why it should escalate', () => {
        const result = buildRoutingRecommendation({
            alert,
            systemId: 'system-1',
            now: '2026-09-14T13:31:00.000Z',
            operators: [operator()]
        });

        expect(result.sla.state).toBe('overdue');
        expect(result.sla.minutesRemaining).toBeLessThan(0);
        expect(result.escalationReasons.join(' ')).toContain('exceeded its response target');
    });

    it('handles support-window timezone and weekday boundaries', () => {
        const window = { timezone: 'America/New_York', days: [1], startMinute: 9 * 60, endMinute: 17 * 60 };

        expect(isWithinSupportWindow(window, '2026-09-14T13:00:00.000Z')).toBe(true);
        expect(isWithinSupportWindow(window, '2026-09-14T21:00:00.000Z')).toBe(false);
        expect(isWithinSupportWindow(window, '2026-09-15T13:00:00.000Z')).toBe(false);
    });

    it('prefers the current operator when several eligible people tie', () => {
        const result = buildRoutingRecommendation({
            alert,
            systemId: 'system-1',
            now: '2026-09-14T13:05:00.000Z',
            preferredOperatorId: 'l2-b',
            operators: [operator(), operator({ operatorId: 'l2-b', displayName: 'L2 B' })]
        });

        expect(result.recommendedOperator?.operatorId).toBe('l2-b');
    });
});
