import { describe, expect, it } from 'vitest';
import type { ActiveJobRecord } from '../../services/ibmi';
import {
    buildOperatorActionPlan,
    getAvailableOperatorActions,
    normalizeOperatorActionRequest
} from './operator-actions';

function createJob(overrides: Partial<ActiveJobRecord> = {}): ActiveJobRecord {
    return {
        JOB_NAME: '738412/QSYSOPR/MSGWJOB',
        JOB_NAME_SHORT: 'MSGWJOB',
        JOB_NUMBER: '738412',
        JOB_USER: 'QSYSOPR',
        SUBSYSTEM: 'QINTER',
        SUBSYSTEM_LIBRARY_NAME: 'QSYS',
        SUBSYSTEM_JOB: 'QINTER/MSGWJOB',
        CURRENT_USER: 'QSYSOPR',
        TYPE: 'INTERACT',
        CPU: 4.3,
        CPU_TIME: 100,
        ELAPSED_CPU_TIME: 200,
        FUNCTION_NAME: 'Waiting on operator reply',
        STATUS: 'MSGW',
        THREAD_COUNT: 1,
        TEMPORARY_STORAGE: 0,
        TOTAL_DISK_IO_COUNT: 0,
        ELAPSED_TOTAL_DISK_IO_COUNT: 0,
        MESSAGE_REPLY: 'YES',
        DATABASE_LOCK_WAITS: 0,
        DATABASE_LOCK_WAIT_TIME: 0,
        NON_DATABASE_LOCK_WAITS: 0,
        NON_DATABASE_LOCK_WAIT_TIME: 0,
        INTERNAL_MACHINE_LOCK_WAITS: 0,
        INTERNAL_MACHINE_LOCK_WAIT_TIME: 0,
        SQL_STATEMENT_TEXT: null,
        SQL_STATEMENT_STATUS: null,
        SQL_STATEMENT_START_TIMESTAMP: null,
        ...overrides
    };
}

describe('operator-actions', () => {
    it('lists actionable job controls and blocks MSGW reply until message context is loaded', () => {
        const actions = getAvailableOperatorActions(createJob());

        expect(actions.find((action) => action.kind === 'holdJob')?.enabled).toBe(true);
        expect(actions.find((action) => action.kind === 'endJob')?.dangerous).toBe(true);
        expect(actions.find((action) => action.kind === 'replyMessage')?.enabled).toBe(false);
        expect(actions.find((action) => action.kind === 'replyMessage')?.reason).toContain('message context');
    });

    it('normalizes action requests and applies the default end option', () => {
        const request = normalizeOperatorActionRequest({
            kind: 'endJob',
            jobName: '738412/QSYSOPR/MSGWJOB'
        });

        expect(request.endOption).toBe('controlled');
        expect(request.jobName).toBe('738412/QSYSOPR/MSGWJOB');
    });

    it('builds CL command execution plans for hold, release, and end job', () => {
        expect(buildOperatorActionPlan({
            kind: 'holdJob',
            jobName: '738412/QSYSOPR/MSGWJOB'
        })).toMatchObject({
            executionType: 'cl',
            command: "HLDJOB JOB(738412/QSYSOPR/MSGWJOB)"
        });

        expect(buildOperatorActionPlan({
            kind: 'releaseJob',
            jobName: '738412/QSYSOPR/MSGWJOB'
        })).toMatchObject({
            executionType: 'cl',
            command: "RLSJOB JOB(738412/QSYSOPR/MSGWJOB)"
        });

        expect(buildOperatorActionPlan({
            kind: 'endJob',
            jobName: '738412/QSYSOPR/MSGWJOB',
            endOption: 'immediate'
        })).toMatchObject({
            executionType: 'cl',
            command: "ENDJOB JOB(738412/QSYSOPR/MSGWJOB) OPTION(*IMMED)"
        });
    });

    it('returns a blocked plan for MSGW reply without message metadata', () => {
        expect(buildOperatorActionPlan({
            kind: 'replyMessage',
            jobName: '738412/QSYSOPR/MSGWJOB',
            replyText: 'C'
        })).toMatchObject({
            executionType: 'blocked'
        });
    });
});
