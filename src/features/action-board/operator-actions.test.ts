import { describe, expect, it } from 'vitest';
import type { ActiveJobRecord } from '../../services/ibmi';
import {
    buildOperatorActionPlan,
    getAvailableOperatorActions,
    normalizeOperatorActionRequest,
    requiresOperatorConfirmation
} from './operator-actions';

function createJob(overrides: Partial<ActiveJobRecord> = {}): ActiveJobRecord {
    return {
        JOB_NAME: '738412/QSYSOPR/MSGWJOB', JOB_NAME_SHORT: 'MSGWJOB', JOB_NUMBER: '738412', JOB_USER: 'QSYSOPR',
        SUBSYSTEM: 'QINTER', SUBSYSTEM_LIBRARY_NAME: 'QSYS', SUBSYSTEM_JOB: 'QINTER/MSGWJOB', CURRENT_USER: 'QSYSOPR', TYPE: 'INTERACT',
        CPU: 4.3, CPU_TIME: 100, ELAPSED_CPU_TIME: 200, FUNCTION_NAME: 'Waiting on operator reply', STATUS: 'MSGW',
        THREAD_COUNT: 1, TEMPORARY_STORAGE: 0, TOTAL_DISK_IO_COUNT: 0, ELAPSED_TOTAL_DISK_IO_COUNT: 0, MESSAGE_REPLY: 'YES',
        DATABASE_LOCK_WAITS: 0, DATABASE_LOCK_WAIT_TIME: 0, NON_DATABASE_LOCK_WAITS: 0, NON_DATABASE_LOCK_WAIT_TIME: 0,
        INTERNAL_MACHINE_LOCK_WAITS: 0, INTERNAL_MACHINE_LOCK_WAIT_TIME: 0, SQL_STATEMENT_TEXT: null,
        SQL_STATEMENT_STATUS: null, SQL_STATEMENT_START_TIMESTAMP: null, ...overrides
    };
}

describe('ActionBoard operator actions', () => {
    it('lists controls and safely blocks MSGW reply without message context', () => {
        const actions = getAvailableOperatorActions(createJob());
        expect(actions.find((action) => action.kind === 'holdJob')?.enabled).toBe(true);
        expect(actions.find((action) => action.kind === 'endJob')?.dangerous).toBe(true);
        expect(actions.find((action) => action.kind === 'replyMessage')?.reason).toContain('message context');
    });

    it('normalizes requests and builds safe CL plans', () => {
        expect(normalizeOperatorActionRequest({ kind: 'endJob', jobName: '  JOB ' }).endOption).toBe('controlled');
        expect(buildOperatorActionPlan({ kind: 'holdJob', jobName: 'JOB' })).toMatchObject({
            executionType: 'cl', command: 'HLDJOB JOB(JOB)'
        });
        expect(buildOperatorActionPlan({ kind: 'endJob', jobName: 'JOB', endOption: 'immediate' })).toMatchObject({
            command: 'ENDJOB JOB(JOB) OPTION(*IMMED)'
        });
    });

    it('blocks unsupported or not-yet-contextual actions', () => {
        expect(buildOperatorActionPlan({ kind: 'replyMessage', jobName: 'JOB', replyText: 'C' })).toMatchObject({
            executionType: 'blocked'
        });
    });

    it('builds a constrained SNDRPY command when message context is available', () => {
        expect(buildOperatorActionPlan({
            kind: 'replyMessage', jobName: 'JOB', replyText: "CONT'INUE", messageKey: 'a1b2c3d4', messageQueue: 'QSYS/QSYSOPR'
        })).toMatchObject({
            executionType: 'cl',
            command: "SNDRPY MSGKEY(X'A1B2C3D4') MSGQ(QSYS/QSYSOPR) RPY('CONT''INUE') RMV(*NO)"
        });
    });

    it('requires confirmation before changing job state', () => {
        expect(requiresOperatorConfirmation('holdJob')).toBe(true);
        expect(requiresOperatorConfirmation('releaseJob')).toBe(true);
        expect(requiresOperatorConfirmation('inspectLocks')).toBe(false);
    });

    it('does not offer state-changing actions for an ended job', () => {
        const actions = getAvailableOperatorActions(createJob({ STATUS: 'END' }));

        expect(actions.find((action) => action.kind === 'holdJob')).toMatchObject({ enabled: false });
        expect(actions.find((action) => action.kind === 'releaseJob')).toMatchObject({ enabled: false });
        expect(actions.find((action) => action.kind === 'endJob')).toMatchObject({ enabled: false });
    });
});
