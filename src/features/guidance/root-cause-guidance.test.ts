import { describe, expect, it } from 'vitest';
import type { ActiveJobRecord } from '../../services/ibmi';
import { buildConnectionGuidance, buildJobRootCauseGuidance } from './root-cause-guidance';

function createJob(overrides: Partial<ActiveJobRecord> = {}): ActiveJobRecord {
    return {
        JOB_NAME: '738412/APPUSR/LOCKJOB',
        JOB_NAME_SHORT: 'LOCKJOB',
        JOB_NUMBER: '738412',
        JOB_USER: 'APPUSR',
        SUBSYSTEM: 'QHTTPSVR',
        SUBSYSTEM_LIBRARY_NAME: 'QSYS',
        SUBSYSTEM_JOB: 'QHTTPSVR/LOCKJOB',
        CURRENT_USER: 'APPUSR',
        TYPE: 'BATCH',
        CPU: 0.6,
        CPU_TIME: 100,
        ELAPSED_CPU_TIME: 200,
        FUNCTION_NAME: 'Waiting on customer row lock',
        STATUS: 'LCKW',
        THREAD_COUNT: 1,
        TEMPORARY_STORAGE: 0,
        TOTAL_DISK_IO_COUNT: 0,
        ELAPSED_TOTAL_DISK_IO_COUNT: 0,
        MESSAGE_REPLY: null,
        DATABASE_LOCK_WAITS: 2,
        DATABASE_LOCK_WAIT_TIME: 6400,
        NON_DATABASE_LOCK_WAITS: 0,
        NON_DATABASE_LOCK_WAIT_TIME: 0,
        INTERNAL_MACHINE_LOCK_WAITS: 0,
        INTERNAL_MACHINE_LOCK_WAIT_TIME: 0,
        SQL_STATEMENT_TEXT: 'update crm.customer set credit_hold = ? where customer_id = ?',
        SQL_STATEMENT_STATUS: 'WAITING',
        SQL_STATEMENT_START_TIMESTAMP: '2026-08-23T10:00:00.000Z',
        ...overrides
    };
}

describe('root-cause-guidance', () => {
    it('builds lock-wait guidance with actionable next steps', () => {
        const guidance = buildJobRootCauseGuidance(createJob(), 80);

        expect(guidance.severity).toBe('critical');
        expect(guidance.headline).toContain('lock wait');
        expect(guidance.nextSteps[0]).toContain('blocking');
    });

    it('builds MSGW guidance for operator reply conditions', () => {
        const guidance = buildJobRootCauseGuidance(createJob({
            STATUS: 'MSGW',
            MESSAGE_REPLY: 'YES',
            FUNCTION_NAME: 'Waiting on operator reply'
        }), 80);

        expect(guidance.headline).toContain('message reply');
        expect(guidance.nextSteps.join(' ')).toContain('message');
    });

    it('builds failed poll guidance from the raw error text', () => {
        const guidance = buildConnectionGuidance('pollFailure', 'connect ETIMEDOUT 10.0.0.10:8076');

        expect(guidance.severity).toBe('critical');
        expect(guidance.likelyCause).toContain('Network');
    });
});
