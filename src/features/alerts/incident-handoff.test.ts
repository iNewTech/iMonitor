import { describe, expect, it } from 'vitest';
import type { MonitorAlert } from './alert-model';
import {
    acceptIncidentHandoff,
    buildShiftHandoffSummary,
    createIncidentHandoff
} from './incident-handoff';

const createdAt = '2026-09-12T10:00:00.000Z';

function makeAlert(overrides: Partial<MonitorAlert> = {}) {
    return {
        id: 'alert-1',
        incidentId: 'incident-1',
        kind: 'lockWait',
        severity: 'critical',
        timestamp: createdAt,
        title: 'LCKW detected',
        message: 'The job is waiting on a lock.',
        jobName: '123/APP/LOCKJOB',
        workflowStatus: 'claimed',
        owner: 'l1-operator',
        notes: [],
        timeline: [],
        workflowUpdatedAt: createdAt,
        isActive: true,
        ...overrides
    } as MonitorAlert;
}

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

    it('summarizes open incidents and pending handoffs for a shift change', () => {
        const pending = createIncidentHandoff({
            incidentId: 'incident-1',
            fromOperator: 'l2-operator',
            toOperator: 'l3-specialist',
            reason: 'Needs lock analysis.',
            pendingChecks: ['Find the blocker'],
            createdAt
        });
        if (!pending.success) throw new Error(pending.error);

        const summary = buildShiftHandoffSummary([
            makeAlert({ handoff: pending.handoff }),
            makeAlert({ id: 'alert-2', incidentId: 'incident-2', isActive: false, title: 'Cleared', message: 'Done.' })
        ], createdAt);

        expect(summary).toContain('Open incidents: 1');
        expect(summary).toContain('pending from l2-operator to l3-specialist');
        expect(summary).toContain('Find the blocker');
        expect(summary).not.toContain('Cleared');
    });
});
