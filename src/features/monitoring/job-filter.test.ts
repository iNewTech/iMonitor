import { describe, expect, it } from 'vitest';
import type { ActiveJobRecord } from '../../services/ibmi';
import { filterJobs, getSubsystemOptions } from './job-filter';

function createJob(overrides: Partial<ActiveJobRecord>): ActiveJobRecord {
    return {
        JOB_NAME: '000001/DEMO/JOB',
        JOB_NAME_SHORT: 'JOB',
        JOB_NUMBER: '000001',
        JOB_USER: 'DEMO',
        SUBSYSTEM: 'QBATCH',
        SUBSYSTEM_LIBRARY_NAME: 'QSYS',
        SUBSYSTEM_JOB: 'QBATCH/JOB',
        CURRENT_USER: 'DEMO',
        TYPE: 'BATCH',
        CPU: 10,
        CPU_TIME: 0,
        ELAPSED_CPU_TIME: 0,
        FUNCTION_NAME: 'Demo workload',
        STATUS: 'RUN',
        THREAD_COUNT: 1,
        TEMPORARY_STORAGE: 0,
        TOTAL_DISK_IO_COUNT: 0,
        ELAPSED_TOTAL_DISK_IO_COUNT: 0,
        MESSAGE_REPLY: 'NO',
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

describe('job-filter', () => {
    const jobs = [
        createJob({
            JOB_NAME: '111111/QSYSOPR/INTERACT',
            JOB_NAME_SHORT: 'INTERACT',
            SUBSYSTEM: 'QINTER',
            SUBSYSTEM_JOB: 'QINTER/INTERACT',
            STATUS: 'MSGW',
            FUNCTION_NAME: 'Interactive order entry'
        }),
        createJob({
            JOB_NAME: '222222/BATCHUSR/NIGHTRUN',
            JOB_NAME_SHORT: 'NIGHTRUN',
            SUBSYSTEM: 'QBATCH',
            SUBSYSTEM_JOB: 'QBATCH/NIGHTRUN',
            STATUS: 'RUN',
            FUNCTION_NAME: 'Night settlement'
        }),
        createJob({
            JOB_NAME: '333333/WEBUSR/APISRV',
            JOB_NAME_SHORT: 'APISRV',
            SUBSYSTEM: 'QHTTPSVR',
            SUBSYSTEM_JOB: 'QHTTPSVR/APISRV',
            STATUS: 'LCKW',
            FUNCTION_NAME: 'REST API'
        })
    ];

    it('builds unique subsystem options for the filter control', () => {
        expect(getSubsystemOptions(jobs)).toEqual(['QBATCH', 'QHTTPSVR', 'QINTER']);
    });

    it('filters jobs by subsystem', () => {
        const filtered = filterJobs(jobs, {
            subsystem: 'QBATCH',
            query: ''
        });

        expect(filtered).toHaveLength(1);
        expect(filtered[0].JOB_NAME_SHORT).toBe('NIGHTRUN');
    });

    it('matches exact and fuzzy operator queries across job fields', () => {
        expect(filterJobs(jobs, {
            subsystem: 'ALL',
            query: 'qinter'
        }).map((job) => job.JOB_NAME_SHORT)).toEqual(['INTERACT']);

        expect(filterJobs(jobs, {
            subsystem: 'ALL',
            query: 'msgw'
        }).map((job) => job.JOB_NAME_SHORT)).toEqual(['INTERACT']);

        expect(filterJobs(jobs, {
            subsystem: 'ALL',
            query: 'interct'
        }).map((job) => job.JOB_NAME_SHORT)).toEqual(['INTERACT']);
    });
});
