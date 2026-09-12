import { describe, expect, it } from 'vitest';
import {
    acceptIncidentHandoff,
    createIncidentHandoff
} from './incident-handoff';

const createdAt = '2026-09-12T10:00:00.000Z';

describe('incident-handoff', () => {
    it('requires a real recipient and keeps response targets timezone safe', () => {
        expect(createIncidentHandoff({
            incidentId: 'incident-1',
            fromOperator: 'l1-operator',
            toOperator: '',
            createdAt
        })).toMatchObject({ success: false, error: 'Choose a recipient before sending the handoff.' });

        const result = createIncidentHandoff({
            incidentId: 'incident-1',
            fromOperator: 'l1-operator',
            toOperator: 'L3 specialist',
            reason: 'Lock owner needs specialist review.',
            pendingChecks: ['Identify blocker', 'Confirm business approval'],
            responseTargetAt: '2026-09-12T15:30:00+05:30',
            createdAt
        });

        expect(result.success).toBe(true);
        if (!result.success) return;
        expect(result.handoff.responseTargetAt).toBe('2026-09-12T10:00:00.000Z');
        expect(result.handoff.pendingChecks).toEqual(['Identify blocker', 'Confirm business approval']);
    });

    it('accepts only the addressed operator and records acceptance', () => {
        const created = createIncidentHandoff({
            incidentId: 'incident-1',
            fromOperator: 'l2-operator',
            toOperator: 'l3-specialist',
            createdAt
        });
        if (!created.success) throw new Error(created.error);

        expect(acceptIncidentHandoff(created.handoff, 'another-operator', createdAt))
            .toMatchObject({ success: false, error: 'This handoff is addressed to l3-specialist.' });
        const accepted = acceptIncidentHandoff(created.handoff, 'l3-specialist', '2026-09-12T10:05:00Z');
        expect(accepted).toMatchObject({ success: true, handoff: { status: 'accepted', acceptedBy: 'l3-specialist' } });
    });

});
