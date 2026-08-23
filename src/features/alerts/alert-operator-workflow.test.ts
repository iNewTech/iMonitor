import { describe, expect, it } from 'vitest';
import {
    acknowledgeAlertWorkflow,
    addAlertWorkflowNote,
    createAlertWorkflowState,
    reopenAlertWorkflow,
    resolveAlertWorkflow,
    startAlertWorkflow
} from './alert-operator-workflow';

describe('alert operator workflow', () => {
    it('creates a new workflow state with a timeline entry', () => {
        const state = createAlertWorkflowState('2026-08-23T10:00:00.000Z', 'MSGW detected');

        expect(state.status).toBe('new');
        expect(state.timeline[0]?.action).toBe('created');
        expect(state.timeline[0]?.detail).toBe('MSGW detected');
    });

    it('transitions through acknowledged, in progress, and resolved states', () => {
        const initial = createAlertWorkflowState('2026-08-23T10:00:00.000Z');
        const acknowledged = acknowledgeAlertWorkflow(initial, {
            timestamp: '2026-08-23T10:01:00.000Z',
            owner: 'Local operator'
        });
        const inProgress = startAlertWorkflow(acknowledged, {
            timestamp: '2026-08-23T10:02:00.000Z',
            owner: 'Local operator'
        });
        const resolved = resolveAlertWorkflow(inProgress, {
            timestamp: '2026-08-23T10:03:00.000Z',
            owner: 'Local operator',
            note: 'Operator replied on the console'
        });

        expect(acknowledged.status).toBe('acknowledged');
        expect(inProgress.status).toBe('in_progress');
        expect(resolved.status).toBe('resolved');
        expect(resolved.timeline[0]?.action).toBe('resolved');
    });

    it('stores notes and reopens a cleared workflow when the condition returns', () => {
        const initial = createAlertWorkflowState('2026-08-23T10:00:00.000Z');
        const withNote = addAlertWorkflowNote(initial, {
            timestamp: '2026-08-23T10:01:00.000Z',
            owner: 'Local operator',
            note: 'Waiting for application owner'
        });
        const reopened = reopenAlertWorkflow(withNote, '2026-08-23T10:02:00.000Z', 'MSGW returned');

        expect(withNote.notes).toHaveLength(1);
        expect(withNote.notes[0]?.text).toBe('Waiting for application owner');
        expect(reopened.status).toBe('new');
        expect(reopened.timeline[0]?.action).toBe('reopened');
    });
});
