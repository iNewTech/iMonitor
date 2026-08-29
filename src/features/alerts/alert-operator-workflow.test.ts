import { describe, expect, it } from 'vitest';
import {
    acknowledgeAlertWorkflow,
    addAlertWorkflowNote,
    claimAlertWorkflow,
    createAlertWorkflowState,
    markAlertWorkDone,
    reopenAlertWorkflow,
    releaseAlertWorkflow,
    systemClearAlertWorkflow
} from './alert-operator-workflow';

describe('alert operator workflow', () => {
    it('creates a new workflow state with a timeline entry', () => {
        const state = createAlertWorkflowState('2026-08-23T10:00:00.000Z', 'MSGW detected');

        expect(state.status).toBe('new');
        expect(state.timeline[0]?.action).toBe('created');
        expect(state.timeline[0]?.detail).toBe('MSGW detected');
    });

    it('transitions through acknowledged, claimed, work done, and system cleared states', () => {
        const initial = createAlertWorkflowState('2026-08-23T10:00:00.000Z');
        const acknowledged = acknowledgeAlertWorkflow(initial, {
            timestamp: '2026-08-23T10:01:00.000Z',
            owner: 'local-user'
        });
        const claimed = claimAlertWorkflow(acknowledged, {
            timestamp: '2026-08-23T10:02:00.000Z',
            owner: 'local-user'
        });
        const workDone = markAlertWorkDone(claimed, {
            timestamp: '2026-08-23T10:03:00.000Z',
            owner: 'local-user',
            note: 'Operator replied on the console'
        });
        const systemCleared = systemClearAlertWorkflow(workDone, {
            timestamp: '2026-08-23T10:04:00.000Z',
            detail: 'Condition cleared in a later poll.'
        });

        expect(acknowledged.status).toBe('acknowledged');
        expect(claimed.status).toBe('claimed');
        expect(workDone.status).toBe('work_done');
        expect(systemCleared.status).toBe('system_cleared');
        expect(systemCleared.timeline[0]?.action).toBe('system_cleared');
    });

    it('releases a claimed alert back into the queue', () => {
        const initial = createAlertWorkflowState('2026-08-23T10:00:00.000Z');
        const claimed = claimAlertWorkflow(initial, {
            timestamp: '2026-08-23T10:01:00.000Z',
            owner: 'local-user'
        });
        const released = releaseAlertWorkflow(claimed, {
            timestamp: '2026-08-23T10:02:00.000Z',
            owner: 'local-user'
        });

        expect(released.status).toBe('acknowledged');
        expect(released.owner).toBeUndefined();
        expect(released.timeline[0]?.action).toBe('released');
    });

    it('stores notes and reopens a cleared workflow when the condition returns', () => {
        const initial = createAlertWorkflowState('2026-08-23T10:00:00.000Z');
        const withNote = addAlertWorkflowNote(initial, {
            timestamp: '2026-08-23T10:01:00.000Z',
            owner: 'local-user',
            note: 'Waiting for application owner'
        });
        const reopened = reopenAlertWorkflow(withNote, '2026-08-23T10:02:00.000Z', 'MSGW returned');

        expect(withNote.notes).toHaveLength(1);
        expect(withNote.notes[0]?.text).toBe('Waiting for application owner');
        expect(withNote.notes[0]?.author).toBe('local-user');
        expect(reopened.status).toBe('new');
        expect(reopened.timeline[0]?.action).toBe('reopened');
    });
});
