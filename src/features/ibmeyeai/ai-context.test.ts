import { describe, expect, it } from 'vitest';
import { buildAiAssistantContext } from './ai-context';
import { DEFAULT_AI_ASSISTANT_SETTINGS } from './ai-model';

describe('ai-context', () => {
    it('builds operator-facing context from alerts, jobs, history, and logs', () => {
        const context = buildAiAssistantContext({
            appName: 'iMonitor',
            connection: {
                name: 'DEV',
                host: 'dummy.local',
                user: 'gtyagi',
                port: 8076
            },
            monitorMode: 'dummy',
            settings: DEFAULT_AI_ASSISTANT_SETTINGS,
            latestJobs: [{
                JOB_NAME: '123456/QSYSOPR/MSGWJOB',
                JOB_NAME_SHORT: 'MSGWJOB',
                JOB_NUMBER: '123456',
                JOB_USER: 'QSYSOPR',
                SUBSYSTEM: 'QINTER',
                SUBSYSTEM_LIBRARY_NAME: 'QSYS',
                SUBSYSTEM_JOB: 'QINTER/MSGWJOB',
                CURRENT_USER: 'QSYSOPR',
                TYPE: 'BATCH',
                CPU: 11.7,
                CPU_TIME: 0,
                ELAPSED_CPU_TIME: 0,
                FUNCTION_NAME: 'Interactive order entry',
                STATUS: 'MSGW',
                THREAD_COUNT: 2,
                TEMPORARY_STORAGE: 200,
                TOTAL_DISK_IO_COUNT: 12,
                ELAPSED_TOTAL_DISK_IO_COUNT: 6,
                MESSAGE_REPLY: 'YES',
                DATABASE_LOCK_WAITS: 0,
                DATABASE_LOCK_WAIT_TIME: 0,
                NON_DATABASE_LOCK_WAITS: 0,
                NON_DATABASE_LOCK_WAIT_TIME: 0,
                INTERNAL_MACHINE_LOCK_WAITS: 0,
                INTERNAL_MACHINE_LOCK_WAIT_TIME: 0,
                SQL_STATEMENT_TEXT: 'select * from orders where status = ?',
                SQL_STATEMENT_STATUS: 'RUNNING',
                SQL_STATEMENT_START_TIMESTAMP: '2026-08-28T10:00:00.000Z'
            }],
            alerts: [{
                id: 'a1',
                kind: 'messageWait',
                severity: 'critical',
                timestamp: '2026-08-28T10:00:00.000Z',
                title: 'MSGW detected',
                message: 'QINTER/MSGWJOB needs a reply.',
                detail: 'Operator action required.',
                jobName: '123456/QSYSOPR/MSGWJOB',
                workflowStatus: 'new',
                notes: [],
                timeline: [],
                workflowUpdatedAt: '2026-08-28T10:00:00.000Z',
                isActive: true
            }],
            monitoringHistory: [{
                timestamp: '2026-08-28T10:00:00.000Z',
                totalJobs: 4,
                peakCpu: 79.1,
                runningJobs: 3,
                waitingJobs: 1,
                messageWaitJobs: 1,
                lockWaitJobs: 0,
                highCpuJobs: 0
            }],
            activityLog: [{
                timestamp: '2026-08-28T10:00:01.000Z',
                area: 'sql',
                level: 'success',
                message: 'SQL executed successfully.',
                detail: 'Rows returned: 4.',
                sql: 'select * from qsys2.active_job_info'
            }],
            selectedJob: null
        });

        expect(context).toContain('Connection: DEV (gtyagi@dummy.local:8076)');
        expect(context).toContain('CRITICAL messageWait job=123456/QSYSOPR/MSGWJOB MSGW detected');
        expect(context).toContain('Correlated incidents and guided recommendations:');
        expect(context).toContain('Incident 1 [CRITICAL]');
        expect(context).toContain('next=Inspect the pending message details before replying.');
        expect(context).toContain('QINTER/MSGWJOB status=MSGW cpu=11.70');
        expect(context).toContain('[SQL] SQL executed successfully.');
    });

    it('respects configured limits so prompts stay compact', () => {
        const context = buildAiAssistantContext({
            appName: 'iMonitor',
            connection: null,
            monitorMode: 'live',
            settings: {
                ...DEFAULT_AI_ASSISTANT_SETTINGS,
                alertLimit: 1,
                jobLimit: 1,
                historyLimit: 1,
                activityLimit: 1
            },
            latestJobs: new Array(3).fill(null).map((_, index) => ({
                JOB_NAME: `${index}`,
                JOB_NAME_SHORT: `JOB${index}`,
                JOB_NUMBER: `${index}`,
                JOB_USER: 'USER',
                SUBSYSTEM: 'QSYS',
                SUBSYSTEM_LIBRARY_NAME: 'QSYS',
                SUBSYSTEM_JOB: `QSYS/JOB${index}`,
                CURRENT_USER: 'USER',
                TYPE: 'BATCH',
                CPU: index,
                CPU_TIME: 0,
                ELAPSED_CPU_TIME: 0,
                FUNCTION_NAME: 'Work',
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
                SQL_STATEMENT_START_TIMESTAMP: null
            })),
            alerts: new Array(3).fill(null).map((_, index) => ({
                id: `${index}`,
                kind: 'highCpu' as const,
                severity: 'warning' as const,
                timestamp: '2026-08-28T10:00:00.000Z',
                title: `Alert ${index}`,
                message: `Message ${index}`,
                workflowStatus: 'new' as const,
                notes: [],
                timeline: [],
                workflowUpdatedAt: '2026-08-28T10:00:00.000Z',
                isActive: true
            })),
            monitoringHistory: [{
                timestamp: '2026-08-28T10:00:00.000Z',
                totalJobs: 1,
                peakCpu: 1,
                runningJobs: 1,
                waitingJobs: 0,
                messageWaitJobs: 0,
                lockWaitJobs: 0,
                highCpuJobs: 0
            }, {
                timestamp: '2026-08-28T10:00:05.000Z',
                totalJobs: 2,
                peakCpu: 2,
                runningJobs: 2,
                waitingJobs: 0,
                messageWaitJobs: 0,
                lockWaitJobs: 0,
                highCpuJobs: 0
            }],
            activityLog: [{
                timestamp: '2026-08-28T10:00:05.000Z',
                area: 'monitoring',
                level: 'info',
                message: 'A',
                detail: ''
            }, {
                timestamp: '2026-08-28T10:00:06.000Z',
                area: 'monitoring',
                level: 'info',
                message: 'B',
                detail: ''
            }],
            selectedJob: null
        });

        expect((context.match(/Alert /g) || [])).toHaveLength(1);
        expect((context.match(/QSYS\/JOB/g) || [])).toHaveLength(1);
        expect((context.match(/totalJobs=/g) || [])).toHaveLength(1);
        expect((context.match(/\[MONITORING\]/g) || [])).toHaveLength(1);
    });
});
