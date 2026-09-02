import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type {
    ActiveJobRecord,
    JobLogRecord,
    JobMessageRecord,
    QueryResult,
    SystemMessageRecord
} from './ibmi';

type DemoSnapshot = QueryResult<ActiveJobRecord> & {
    generatedAt?: string;
    pollCount?: number;
};

const JOB_COLUMNS = [
    'JOB_NAME', 'JOB_NAME_SHORT', 'JOB_NUMBER', 'JOB_USER', 'SUBSYSTEM',
    'SUBSYSTEM_LIBRARY_NAME', 'SUBSYSTEM_JOB', 'CURRENT_USER', 'TYPE', 'CPU',
    'CPU_TIME', 'ELAPSED_CPU_TIME', 'FUNCTION_NAME', 'STATUS', 'THREAD_COUNT',
    'TEMPORARY_STORAGE', 'TOTAL_DISK_IO_COUNT', 'ELAPSED_TOTAL_DISK_IO_COUNT',
    'MESSAGE_REPLY', 'DATABASE_LOCK_WAITS', 'DATABASE_LOCK_WAIT_TIME',
    'NON_DATABASE_LOCK_WAITS', 'NON_DATABASE_LOCK_WAIT_TIME',
    'INTERNAL_MACHINE_LOCK_WAITS', 'INTERNAL_MACHINE_LOCK_WAIT_TIME',
    'SQL_STATEMENT_TEXT', 'SQL_STATEMENT_STATUS', 'SQL_STATEMENT_START_TIMESTAMP'
] as const;

function value(record: Record<string, unknown>, key: string): SQLInputValue {
    const candidate = record[key];
    if (candidate === null || candidate === undefined) {
        return null;
    }
    if (typeof candidate === 'string' || typeof candidate === 'number' || typeof candidate === 'bigint') {
        return candidate;
    }

    return String(candidate);
}

function queueNameFor(job: ActiveJobRecord) {
    if (job.TYPE === 'BATCH' || job.SUBSYSTEM === 'QBATCH') {
        return 'QBATCH';
    }

    return 'QINTER';
}

/**
 * Local SQLite data source used only by the development demo connection.
 * The table names and columns mirror the QSYS2 views used by the live service.
 */
export class DemoDatabase {
    private readonly database: DatabaseSync;

    constructor(filePath: string) {
        mkdirSync(dirname(filePath), { recursive: true });
        this.database = new DatabaseSync(filePath);
        this.database.exec(`
            PRAGMA journal_mode = WAL;

            CREATE TABLE IF NOT EXISTS active_job_info (
                JOB_NAME TEXT PRIMARY KEY,
                JOB_NAME_SHORT TEXT, JOB_NUMBER TEXT, JOB_USER TEXT,
                SUBSYSTEM TEXT, SUBSYSTEM_LIBRARY_NAME TEXT, SUBSYSTEM_JOB TEXT,
                CURRENT_USER TEXT, TYPE TEXT, CPU REAL, CPU_TIME REAL,
                ELAPSED_CPU_TIME REAL, FUNCTION_NAME TEXT, STATUS TEXT,
                THREAD_COUNT REAL, TEMPORARY_STORAGE REAL, TOTAL_DISK_IO_COUNT REAL,
                ELAPSED_TOTAL_DISK_IO_COUNT REAL, MESSAGE_REPLY TEXT,
                DATABASE_LOCK_WAITS REAL, DATABASE_LOCK_WAIT_TIME REAL,
                NON_DATABASE_LOCK_WAITS REAL, NON_DATABASE_LOCK_WAIT_TIME REAL,
                INTERNAL_MACHINE_LOCK_WAITS REAL, INTERNAL_MACHINE_LOCK_WAIT_TIME REAL,
                SQL_STATEMENT_TEXT TEXT, SQL_STATEMENT_STATUS TEXT,
                SQL_STATEMENT_START_TIMESTAMP TEXT
            );

            CREATE TABLE IF NOT EXISTS job_info (
                JOB_NAME TEXT PRIMARY KEY, JOB_STATUS TEXT, JOB_SUBSYSTEM TEXT,
                JOB_QUEUE_NAME TEXT, JOB_QUEUE_LIBRARY TEXT, JOB_QUEUE_STATUS TEXT,
                JOB_QUEUE_TOTAL_JOBS REAL, JOB_QUEUE_MAX_ACTIVE_JOBS REAL,
                JOB_QUEUE_TEXT TEXT
            );

            CREATE TABLE IF NOT EXISTS job_queue_info (
                JOB_QUEUE_NAME TEXT, JOB_QUEUE_LIBRARY TEXT, STATUS TEXT,
                CURRENT_JOBS REAL, MAX_ACTIVE_JOBS REAL, TEXT_DESCRIPTION TEXT,
                PRIMARY KEY (JOB_QUEUE_NAME, JOB_QUEUE_LIBRARY)
            );

            CREATE TABLE IF NOT EXISTS subsystem_info (
                SUBSYSTEM_DESCRIPTION TEXT, SUBSYSTEM_DESCRIPTION_LIBRARY TEXT,
                STATUS TEXT, CURRENT_ACTIVE_JOBS REAL, MAX_ACTIVE_JOBS REAL,
                TEXT_DESCRIPTION TEXT,
                PRIMARY KEY (SUBSYSTEM_DESCRIPTION, SUBSYSTEM_DESCRIPTION_LIBRARY)
            );

            CREATE TABLE IF NOT EXISTS joblog_info (
                ORDINAL_POSITION REAL, MESSAGE_ID TEXT, MESSAGE_TYPE TEXT,
                MESSAGE_TIMESTAMP TEXT, MESSAGE_TEXT TEXT,
                MESSAGE_SECOND_LEVEL_TEXT TEXT, MESSAGE_KEY_HEX TEXT,
                QUALIFIED_JOB_NAME TEXT
            );

            CREATE TABLE IF NOT EXISTS message_queue_info (
                MESSAGE_QUEUE_LIBRARY TEXT, MESSAGE_QUEUE_NAME TEXT,
                MESSAGE_KEY_HEX TEXT, MESSAGE_ID TEXT, MESSAGE_TYPE TEXT,
                FROM_USER TEXT, FROM_JOB TEXT, MESSAGE_TIMESTAMP TEXT,
                MESSAGE_TEXT TEXT, MESSAGE_SECOND_LEVEL_TEXT TEXT
            );

            CREATE TABLE IF NOT EXISTS monitoring_snapshots (
                POLL_COUNT REAL PRIMARY KEY, GENERATED_AT TEXT NOT NULL,
                JOB_COUNT REAL NOT NULL
            );
        `);
    }

    refresh(snapshot: DemoSnapshot) {
        const jobs = Array.isArray(snapshot.data) ? snapshot.data : [];
        const generatedAt = snapshot.generatedAt || new Date().toISOString();
        const pollCount = Number(snapshot.pollCount || 0);

        this.database.exec('BEGIN');
        try {
            this.database.exec(`
                DELETE FROM active_job_info;
                DELETE FROM job_info;
                DELETE FROM job_queue_info;
                DELETE FROM subsystem_info;
                DELETE FROM joblog_info;
                DELETE FROM message_queue_info;
                DELETE FROM monitoring_snapshots;
            `);

            const activeJobStatement = this.database.prepare(`
                INSERT INTO active_job_info (${JOB_COLUMNS.join(', ')})
                VALUES (${JOB_COLUMNS.map(() => '?').join(', ')})
            `);
            const jobInfoStatement = this.database.prepare(`
                INSERT INTO job_info (
                    JOB_NAME, JOB_STATUS, JOB_SUBSYSTEM, JOB_QUEUE_NAME,
                    JOB_QUEUE_LIBRARY, JOB_QUEUE_STATUS, JOB_QUEUE_TOTAL_JOBS,
                    JOB_QUEUE_MAX_ACTIVE_JOBS, JOB_QUEUE_TEXT
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            const jobLogStatement = this.database.prepare(`
                INSERT INTO joblog_info (
                    ORDINAL_POSITION, MESSAGE_ID, MESSAGE_TYPE, MESSAGE_TIMESTAMP,
                    MESSAGE_TEXT, MESSAGE_SECOND_LEVEL_TEXT, MESSAGE_KEY_HEX,
                    QUALIFIED_JOB_NAME
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `);
            const messageStatement = this.database.prepare(`
                INSERT INTO message_queue_info (
                    MESSAGE_QUEUE_LIBRARY, MESSAGE_QUEUE_NAME, MESSAGE_KEY_HEX,
                    MESSAGE_ID, MESSAGE_TYPE, FROM_USER, FROM_JOB,
                    MESSAGE_TIMESTAMP, MESSAGE_TEXT, MESSAGE_SECOND_LEVEL_TEXT
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);

            const queueCounts = new Map<string, number>();
            const subsystemCounts = new Map<string, number>();

            jobs.forEach((job, index) => {
                activeJobStatement.run(...JOB_COLUMNS.map((column) => value(job as unknown as Record<string, unknown>, column)));

                const queueName = queueNameFor(job);
                const queueKey = `${queueName}/QGPL`;
                queueCounts.set(queueKey, (queueCounts.get(queueKey) || 0) + 1);
                const subsystem = job.SUBSYSTEM || 'QSYSWRK';
                const subsystemKey = `${subsystem}/${job.SUBSYSTEM_LIBRARY_NAME || 'QSYS'}`;
                subsystemCounts.set(subsystemKey, (subsystemCounts.get(subsystemKey) || 0) + 1);

                jobInfoStatement.run(
                    job.JOB_NAME,
                    job.STATUS,
                    subsystem,
                    queueName,
                    'QGPL',
                    'RELEASED',
                    queueCounts.get(queueKey) ?? 0,
                    10,
                    `${queueName} demo job queue`
                );
                jobLogStatement.run(
                    index + 1,
                    job.STATUS === 'MSGW' ? 'DEMO0001' : null,
                    job.STATUS === 'MSGW' ? 'INQUIRY' : 'STATUS',
                    generatedAt,
                    job.STATUS === 'MSGW'
                        ? 'Demo MSGW requires an operator reply.'
                        : `${job.JOB_NAME_SHORT || 'Job'} is currently ${job.STATUS || 'unknown'}.`,
                    job.STATUS === 'MSGW' ? 'Demo message context is stored locally.' : null,
                    null,
                    job.JOB_NAME
                );

                if (job.STATUS === 'MSGW') {
                    messageStatement.run(
                        'QSYS',
                        'QSYSOPR',
                        null,
                        `DEMO${String(index + 1).padStart(4, '0')}`,
                        'INQUIRY',
                        job.CURRENT_USER,
                        job.JOB_NAME,
                        generatedAt,
                        'Demo MSGW requires an operator reply.',
                        'Demo mode does not contain a live message key.'
                    );
                }
            });

            const queueStatement = this.database.prepare(`
                INSERT INTO job_queue_info (
                    JOB_QUEUE_NAME, JOB_QUEUE_LIBRARY, STATUS, CURRENT_JOBS,
                    MAX_ACTIVE_JOBS, TEXT_DESCRIPTION
                ) VALUES (?, ?, ?, ?, ?, ?)
            `);
            queueCounts.forEach((count, key) => {
                const [queueName, library] = key.split('/');
                queueStatement.run(queueName, library, 'RELEASED', count, 10, `${queueName} demo job queue`);
            });

            const subsystemStatement = this.database.prepare(`
                INSERT INTO subsystem_info (
                    SUBSYSTEM_DESCRIPTION, SUBSYSTEM_DESCRIPTION_LIBRARY, STATUS,
                    CURRENT_ACTIVE_JOBS, MAX_ACTIVE_JOBS, TEXT_DESCRIPTION
                ) VALUES (?, ?, ?, ?, ?, ?)
            `);
            subsystemCounts.forEach((count, key) => {
                const [subsystem, library] = key.split('/');
                subsystemStatement.run(subsystem, library, 'ACTIVE', count, 100, `${subsystem} demo subsystem`);
            });

            this.database.prepare(`
                INSERT INTO monitoring_snapshots (POLL_COUNT, GENERATED_AT, JOB_COUNT)
                VALUES (?, ?, ?)
            `).run(pollCount, generatedAt, jobs.length);
            this.database.exec('COMMIT');
        } catch (error) {
            this.database.exec('ROLLBACK');
            throw error;
        }
    }

    getActiveJobs(): DemoSnapshot {
        const records = this.database.prepare(`
            SELECT ${JOB_COLUMNS.join(', ')}
            FROM active_job_info
            ORDER BY CPU DESC
        `).all() as unknown as ActiveJobRecord[];
        const snapshot = this.database.prepare(`
            SELECT GENERATED_AT, POLL_COUNT FROM monitoring_snapshots
            ORDER BY POLL_COUNT DESC LIMIT 1
        `).get() as { GENERATED_AT?: string; POLL_COUNT?: number } | undefined;

        return {
            data: records,
            generatedAt: snapshot?.GENERATED_AT,
            pollCount: snapshot?.POLL_COUNT
        };
    }

    getJobLog(jobName: string) {
        return this.database.prepare(`
            SELECT ORDINAL_POSITION, MESSAGE_ID, MESSAGE_TYPE, MESSAGE_TIMESTAMP,
                   MESSAGE_TEXT, MESSAGE_SECOND_LEVEL_TEXT, MESSAGE_KEY_HEX,
                   QUALIFIED_JOB_NAME
            FROM joblog_info
            WHERE QUALIFIED_JOB_NAME = ?
            ORDER BY ORDINAL_POSITION DESC
            LIMIT 100
        `).all(jobName) as unknown as JobLogRecord[];
    }

    getJobMessages(jobName: string) {
        return this.database.prepare(`
            SELECT MESSAGE_QUEUE_LIBRARY, MESSAGE_QUEUE_NAME, MESSAGE_KEY_HEX,
                   MESSAGE_ID, MESSAGE_TYPE, FROM_USER, FROM_JOB,
                   MESSAGE_TIMESTAMP, MESSAGE_TEXT, MESSAGE_SECOND_LEVEL_TEXT
            FROM message_queue_info
            WHERE FROM_JOB = ?
            ORDER BY MESSAGE_TIMESTAMP DESC
            LIMIT 20
        `).all(jobName) as unknown as JobMessageRecord[];
    }

    getSystemMessages() {
        return this.database.prepare(`
            SELECT MESSAGE_QUEUE_LIBRARY, MESSAGE_QUEUE_NAME, MESSAGE_KEY_HEX,
                   MESSAGE_ID, MESSAGE_TYPE, FROM_USER, FROM_JOB,
                   MESSAGE_TIMESTAMP, MESSAGE_TEXT, MESSAGE_SECOND_LEVEL_TEXT
            FROM message_queue_info
            ORDER BY MESSAGE_TIMESTAMP DESC
            LIMIT 100
        `).all() as unknown as SystemMessageRecord[];
    }

    getJobContext(jobName: string) {
        const jobInfo = this.database.prepare(`
            SELECT * FROM job_info WHERE JOB_NAME = ? LIMIT 1
        `).get(jobName) as Record<string, unknown> | undefined;
        if (!jobInfo) {
            return { jobInfo: null, jobQueue: null, subsystem: null };
        }

        const jobQueue = this.database.prepare(`
            SELECT * FROM job_queue_info
            WHERE JOB_QUEUE_NAME = ? AND JOB_QUEUE_LIBRARY = ? LIMIT 1
        `).get(
            String(jobInfo.JOB_QUEUE_NAME || ''),
            String(jobInfo.JOB_QUEUE_LIBRARY || '')
        ) as Record<string, unknown> | undefined;
        const subsystem = this.database.prepare(`
            SELECT * FROM subsystem_info
            WHERE SUBSYSTEM_DESCRIPTION = ?
              AND SUBSYSTEM_DESCRIPTION_LIBRARY = ? LIMIT 1
        `).get(String(jobInfo.JOB_SUBSYSTEM || ''), 'QSYS') as Record<string, unknown> | undefined;

        return {
            jobInfo,
            jobQueue: jobQueue || null,
            subsystem: subsystem || null
        };
    }

    close() {
        this.database.close();
    }
}
