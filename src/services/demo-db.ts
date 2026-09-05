import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type {
  ActiveJobRecord,
    JobQueueRecord,
    JobLogRecord,
    JobMessageRecord,
    PagedResult,
    QueuedJobRecord,
    QueryResult,
    SystemMessageRecord
} from './ibmi';
import {
    decodeCursor,
    encodeCursor,
    matchesSearch,
    normalizePageSize,
    queueKey,
    type JobQueueQuery,
    type QueuedJobQuery
} from '../features/action-board/job-queue-model';

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

function ensureColumn(database: DatabaseSync, tableName: string, columnDefinition: string) {
    try {
        database.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnDefinition}`);
    } catch (error) {
        if (!(error instanceof Error) || !/duplicate column name/i.test(error.message)) {
            throw error;
        }
    }
}

function queueNameFor(job: ActiveJobRecord) {
    if (job.TYPE === 'BATCH' || job.SUBSYSTEM === 'QBATCH') {
        return 'QBATCH';
    }

    return 'QINTER';
}

function buildDemoQueuedJobs(generatedAt: Date): QueuedJobRecord[] {
    const queuedAt = (minutesAgo: number) => new Date(generatedAt.getTime() - minutesAgo * 60_000).toISOString();
    const enteredAt = (minutesAgo: number) => new Date(generatedAt.getTime() - minutesAgo * 60_000 - 15_000).toISOString();

    return [
        {
            JOB_NAME: '731001/QBATCH/INVOICE01',
            JOB_NAME_SHORT: 'INVOICE01',
            JOB_NUMBER: '731001',
            JOB_USER: 'APORDR',
            JOB_STATUS: 'JOBQ',
            JOB_TYPE: 'BATCH',
            JOB_TYPE_ENHANCED: 'BATCH',
            JOB_QUEUE_NAME: 'QBATCH',
            JOB_QUEUE_LIBRARY: 'QGPL',
            JOB_QUEUE_STATUS: 'RELEASED',
            JOB_QUEUE_PRIORITY: 3,
            JOB_QUEUE_TIME: queuedAt(19),
            JOB_ENTERED_SYSTEM_TIME: enteredAt(19),
            SUBSYSTEM: 'QBATCH',
            SUBSYSTEM_LIBRARY_NAME: 'QSYS'
        },
        {
            JOB_NAME: '731002/QBATCH/NIGHTPOST',
            JOB_NAME_SHORT: 'NIGHTPOST',
            JOB_NUMBER: '731002',
            JOB_USER: 'BATCHUSR',
            JOB_STATUS: 'JOBQ',
            JOB_TYPE: 'BATCH',
            JOB_TYPE_ENHANCED: 'BATCH',
            JOB_QUEUE_NAME: 'QBATCH',
            JOB_QUEUE_LIBRARY: 'QGPL',
            JOB_QUEUE_STATUS: 'RELEASED',
            JOB_QUEUE_PRIORITY: 5,
            JOB_QUEUE_TIME: queuedAt(11),
            JOB_ENTERED_SYSTEM_TIME: enteredAt(11),
            SUBSYSTEM: 'QBATCH',
            SUBSYSTEM_LIBRARY_NAME: 'QSYS'
        },
        {
            JOB_NAME: '731003/QPGMR/ORDERAPI',
            JOB_NAME_SHORT: 'ORDERAPI',
            JOB_NUMBER: '731003',
            JOB_USER: 'QPGMR',
            JOB_STATUS: 'JOBQ',
            JOB_TYPE: 'BATCH',
            JOB_TYPE_ENHANCED: 'BATCH',
            JOB_QUEUE_NAME: 'QINTER',
            JOB_QUEUE_LIBRARY: 'QGPL',
            JOB_QUEUE_STATUS: 'RELEASED',
            JOB_QUEUE_PRIORITY: 4,
            JOB_QUEUE_TIME: queuedAt(8),
            JOB_ENTERED_SYSTEM_TIME: enteredAt(8),
            SUBSYSTEM: 'QINTER',
            SUBSYSTEM_LIBRARY_NAME: 'QSYS'
        },
        {
            JOB_NAME: '731004/QSYSOPR/REPORT01',
            JOB_NAME_SHORT: 'REPORT01',
            JOB_NUMBER: '731004',
            JOB_USER: 'QSYSOPR',
            JOB_STATUS: 'JOBQ',
            JOB_TYPE: 'BATCH',
            JOB_TYPE_ENHANCED: 'BATCH',
            JOB_QUEUE_NAME: 'QARCHIVE',
            JOB_QUEUE_LIBRARY: 'QGPL',
            JOB_QUEUE_STATUS: 'HELD',
            JOB_QUEUE_PRIORITY: 7,
            JOB_QUEUE_TIME: queuedAt(44),
            JOB_ENTERED_SYSTEM_TIME: enteredAt(44),
            SUBSYSTEM: 'QSYSWRK',
            SUBSYSTEM_LIBRARY_NAME: 'QSYS'
        },
        {
            JOB_NAME: '731005/QUSER/SYNCJOB',
            JOB_NAME_SHORT: 'SYNCJOB',
            JOB_NUMBER: '731005',
            JOB_USER: 'QUSER',
            JOB_STATUS: 'JOBQ',
            JOB_TYPE: 'BATCH',
            JOB_TYPE_ENHANCED: 'BATCH',
            JOB_QUEUE_NAME: 'QHTTPSVR',
            JOB_QUEUE_LIBRARY: 'QGPL',
            JOB_QUEUE_STATUS: 'RELEASED',
            JOB_QUEUE_PRIORITY: 2,
            JOB_QUEUE_TIME: queuedAt(4),
            JOB_ENTERED_SYSTEM_TIME: enteredAt(4),
            SUBSYSTEM: 'QHTTPSVR',
            SUBSYSTEM_LIBRARY_NAME: 'QSYS'
        }
    ];
}

/**
 * Local SQLite data source used only by the development demo connection.
 * The table names and columns mirror the QSYS2 views used by the live service.
 */
export class DemoDatabase {
    private readonly database: DatabaseSync;
    private readonly jobQueueStatusOverrides = new Map<string, string>();
    private readonly queuedJobStatusOverrides = new Map<string, string>();

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
                NUMBER_OF_JOBS REAL, ACTIVE_JOBS REAL, MAXIMUM_ACTIVE_JOBS REAL,
                HELD_JOBS REAL, RELEASED_JOBS REAL, SCHEDULED_JOBS REAL,
                CURRENT_JOBS REAL, MAX_ACTIVE_JOBS REAL, TEXT_DESCRIPTION TEXT,
                PRIMARY KEY (JOB_QUEUE_NAME, JOB_QUEUE_LIBRARY)
            );

            CREATE TABLE IF NOT EXISTS queued_job_info (
                JOB_NAME TEXT PRIMARY KEY, JOB_NAME_SHORT TEXT, JOB_NUMBER TEXT,
                JOB_USER TEXT, JOB_STATUS TEXT, JOB_TYPE TEXT,
                JOB_TYPE_ENHANCED TEXT, JOB_QUEUE_NAME TEXT, JOB_QUEUE_LIBRARY TEXT,
                JOB_QUEUE_STATUS TEXT, JOB_QUEUE_PRIORITY REAL, JOB_QUEUE_TIME TEXT,
                JOB_ENTERED_SYSTEM_TIME TEXT, SUBSYSTEM TEXT,
                SUBSYSTEM_LIBRARY_NAME TEXT
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
        ensureColumn(this.database, 'job_queue_info', 'NUMBER_OF_JOBS REAL');
        ensureColumn(this.database, 'job_queue_info', 'ACTIVE_JOBS REAL');
        ensureColumn(this.database, 'job_queue_info', 'MAXIMUM_ACTIVE_JOBS REAL');
        ensureColumn(this.database, 'job_queue_info', 'HELD_JOBS REAL');
        ensureColumn(this.database, 'job_queue_info', 'RELEASED_JOBS REAL');
        ensureColumn(this.database, 'job_queue_info', 'SCHEDULED_JOBS REAL');
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
                DELETE FROM queued_job_info;
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

            const activeQueueCounts = new Map<string, number>();
            const waitingQueueCounts = new Map<string, number>();
            const subsystemCounts = new Map<string, number>();

            jobs.forEach((job, index) => {
                activeJobStatement.run(...JOB_COLUMNS.map((column) => value(job as unknown as Record<string, unknown>, column)));

                const queueName = queueNameFor(job);
                const queueIdentity = queueKey(queueName, 'QGPL');
                activeQueueCounts.set(queueIdentity, (activeQueueCounts.get(queueIdentity) || 0) + 1);
                const subsystem = job.SUBSYSTEM || 'QSYSWRK';
                const subsystemKey = `${subsystem}/${job.SUBSYSTEM_LIBRARY_NAME || 'QSYS'}`;
                subsystemCounts.set(subsystemKey, (subsystemCounts.get(subsystemKey) || 0) + 1);

                jobInfoStatement.run(
                    job.JOB_NAME,
                    job.STATUS,
                    subsystem,
                    queueName,
                    'QGPL',
                    this.jobQueueStatusOverrides.get(queueIdentity) || 'RELEASED',
                    activeQueueCounts.get(queueIdentity) ?? 0,
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
                    JOB_QUEUE_NAME, JOB_QUEUE_LIBRARY, STATUS, NUMBER_OF_JOBS,
                    ACTIVE_JOBS, MAXIMUM_ACTIVE_JOBS, HELD_JOBS, RELEASED_JOBS,
                    SCHEDULED_JOBS, CURRENT_JOBS, MAX_ACTIVE_JOBS, TEXT_DESCRIPTION
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            const queuedJobStatement = this.database.prepare(`
                INSERT INTO queued_job_info (
                    JOB_NAME, JOB_NAME_SHORT, JOB_NUMBER, JOB_USER, JOB_STATUS,
                    JOB_TYPE, JOB_TYPE_ENHANCED, JOB_QUEUE_NAME, JOB_QUEUE_LIBRARY,
                    JOB_QUEUE_STATUS, JOB_QUEUE_PRIORITY, JOB_QUEUE_TIME,
                    JOB_ENTERED_SYSTEM_TIME, SUBSYSTEM, SUBSYSTEM_LIBRARY_NAME
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            const queuedJobs = buildDemoQueuedJobs(new Date(generatedAt));
            queuedJobs.forEach((job) => {
                const identity = queueKey(job.JOB_QUEUE_NAME, job.JOB_QUEUE_LIBRARY);
                waitingQueueCounts.set(identity, (waitingQueueCounts.get(identity) || 0) + 1);
                queuedJobStatement.run(
                    job.JOB_NAME,
                    job.JOB_NAME_SHORT,
                    job.JOB_NUMBER,
                    job.JOB_USER,
                    this.queuedJobStatusOverrides.get(job.JOB_NAME) || job.JOB_STATUS,
                    job.JOB_TYPE,
                    job.JOB_TYPE_ENHANCED,
                    job.JOB_QUEUE_NAME,
                    job.JOB_QUEUE_LIBRARY,
                    this.jobQueueStatusOverrides.get(identity)
                        || this.queuedJobStatusOverrides.get(job.JOB_NAME)
                        || job.JOB_QUEUE_STATUS,
                    job.JOB_QUEUE_PRIORITY,
                    job.JOB_QUEUE_TIME,
                    job.JOB_ENTERED_SYSTEM_TIME,
                    job.SUBSYSTEM,
                    job.SUBSYSTEM_LIBRARY_NAME
                );
            });

            const allQueueIdentities = new Set([
                ...activeQueueCounts.keys(),
                ...waitingQueueCounts.keys()
            ]);
            allQueueIdentities.forEach((identity) => {
                const [library, queueName] = identity.split('/');
                const status = this.jobQueueStatusOverrides.get(identity)
                    || queuedJobs.find((job) => queueKey(job.JOB_QUEUE_NAME, job.JOB_QUEUE_LIBRARY) === identity)?.JOB_QUEUE_STATUS
                    || 'RELEASED';
                queueStatement.run(
                    queueName,
                    library,
                    status,
                    waitingQueueCounts.get(identity) || 0,
                    activeQueueCounts.get(identity) || 0,
                    10,
                    0,
                    waitingQueueCounts.get(identity) || 0,
                    0,
                    waitingQueueCounts.get(identity) || 0,
                    10,
                    `${queueName} demo job queue`
                );
            });

            queuedJobs.forEach((job) => {
                const identity = queueKey(job.JOB_QUEUE_NAME, job.JOB_QUEUE_LIBRARY);
                jobInfoStatement.run(
                    job.JOB_NAME,
                    this.queuedJobStatusOverrides.get(job.JOB_NAME) || job.JOB_STATUS,
                    job.SUBSYSTEM,
                    job.JOB_QUEUE_NAME,
                    job.JOB_QUEUE_LIBRARY,
                    this.jobQueueStatusOverrides.get(identity)
                        || this.queuedJobStatusOverrides.get(job.JOB_NAME)
                        || job.JOB_QUEUE_STATUS,
                    waitingQueueCounts.get(identity) || 0,
                    10,
                    `${job.JOB_QUEUE_NAME} demo job queue`
                );
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

    getJobQueues(options: JobQueueQuery = {}): PagedResult<JobQueueRecord> {
        const limit = normalizePageSize(options.limit);
        const search = options.search?.trim() || '';
        const status = options.status?.trim().toUpperCase() || 'ALL';
        const cursor = decodeCursor<{ library?: string; name?: string }>(options.cursor);
        const rows = this.database.prepare(`
            SELECT q.JOB_QUEUE_NAME, q.JOB_QUEUE_LIBRARY, q.STATUS, q.NUMBER_OF_JOBS,
                   q.ACTIVE_JOBS, q.MAXIMUM_ACTIVE_JOBS, q.HELD_JOBS, q.TEXT_DESCRIPTION,
                   (
                       SELECT MIN(j.SUBSYSTEM)
                       FROM queued_job_info j
                       WHERE j.JOB_QUEUE_NAME = q.JOB_QUEUE_NAME
                         AND j.JOB_QUEUE_LIBRARY = q.JOB_QUEUE_LIBRARY
                   ) AS SUBSYSTEM_NAME,
                   (
                       SELECT MIN(j.SUBSYSTEM_LIBRARY_NAME)
                       FROM queued_job_info j
                       WHERE j.JOB_QUEUE_NAME = q.JOB_QUEUE_NAME
                         AND j.JOB_QUEUE_LIBRARY = q.JOB_QUEUE_LIBRARY
                   ) AS SUBSYSTEM_LIBRARY_NAME
            FROM job_queue_info q
            ORDER BY q.JOB_QUEUE_LIBRARY, q.JOB_QUEUE_NAME
        `).all() as unknown as Array<Record<string, unknown>>;
        const filtered = rows
            .map((row) => ({
                JOB_QUEUE_NAME: String(row.JOB_QUEUE_NAME || ''),
                JOB_QUEUE_LIBRARY: String(row.JOB_QUEUE_LIBRARY || 'QGPL'),
                JOB_QUEUE_STATUS: String(row.STATUS || 'UNKNOWN'),
                SUBSYSTEM_NAME: row.SUBSYSTEM_NAME ? String(row.SUBSYSTEM_NAME) : null,
                SUBSYSTEM_LIBRARY_NAME: row.SUBSYSTEM_LIBRARY_NAME ? String(row.SUBSYSTEM_LIBRARY_NAME) : null,
                SEQUENCE_NUMBER: null,
                OPERATOR_CONTROLLED: null,
                WAITING_JOBS: Number(row.NUMBER_OF_JOBS || 0),
                ACTIVE_JOBS: Number(row.ACTIVE_JOBS || 0),
                MAX_ACTIVE_JOBS: Number(row.MAXIMUM_ACTIVE_JOBS || 0),
                HELD_JOBS: Number(row.HELD_JOBS || 0),
                TEXT_DESCRIPTION: row.TEXT_DESCRIPTION ? String(row.TEXT_DESCRIPTION) : null,
                OLDEST_WAIT_TIME: null
            }))
            .filter((queue) => (status === 'ALL' || queue.JOB_QUEUE_STATUS.toUpperCase() === status))
            .filter((queue) => matchesSearch([
                queue.JOB_QUEUE_NAME,
                queue.JOB_QUEUE_LIBRARY,
                queue.SUBSYSTEM_NAME,
                queue.SUBSYSTEM_LIBRARY_NAME,
                queue.TEXT_DESCRIPTION
            ], search))
            .filter((queue) => !cursor
                || queue.JOB_QUEUE_LIBRARY > String(cursor.library || '')
                || (
                    queue.JOB_QUEUE_LIBRARY === String(cursor.library || '')
                    && queue.JOB_QUEUE_NAME > String(cursor.name || '')
                ));
        const hasMore = filtered.length > limit;
        const data = hasMore ? filtered.slice(0, limit) : filtered;
        const last = data[data.length - 1];

        return {
            data,
            hasMore,
            nextCursor: hasMore && last
                ? encodeCursor({ library: last.JOB_QUEUE_LIBRARY, name: last.JOB_QUEUE_NAME })
                : null
        };
    }

    getJobQueueDetails(queueName: string, queueLibrary = 'QGPL') {
        return this.database.prepare(`
            SELECT q.*,
                   (
                       SELECT MIN(j.SUBSYSTEM)
                       FROM queued_job_info j
                       WHERE j.JOB_QUEUE_NAME = q.JOB_QUEUE_NAME
                         AND j.JOB_QUEUE_LIBRARY = q.JOB_QUEUE_LIBRARY
                   ) AS SUBSYSTEM_NAME,
                   (
                       SELECT MIN(j.SUBSYSTEM_LIBRARY_NAME)
                       FROM queued_job_info j
                       WHERE j.JOB_QUEUE_NAME = q.JOB_QUEUE_NAME
                         AND j.JOB_QUEUE_LIBRARY = q.JOB_QUEUE_LIBRARY
                   ) AS SUBSYSTEM_LIBRARY_NAME
            FROM job_queue_info q
            WHERE q.JOB_QUEUE_NAME = ? AND q.JOB_QUEUE_LIBRARY = ?
            LIMIT 1
        `).get(queueName, queueLibrary) as Record<string, unknown> | undefined || null;
    }

    getSubsystemDetails(subsystemName: string, subsystemLibrary = 'QSYS') {
        return this.database.prepare(`
            SELECT * FROM subsystem_info
            WHERE SUBSYSTEM_DESCRIPTION = ?
              AND SUBSYSTEM_DESCRIPTION_LIBRARY = ?
            LIMIT 1
        `).get(subsystemName, subsystemLibrary) as Record<string, unknown> | undefined || null;
    }

    getQueuedJobs(options: QueuedJobQuery = {}): PagedResult<QueuedJobRecord> {
        const limit = normalizePageSize(options.limit);
        const search = options.search?.trim() || '';
        const status = options.status?.trim().toUpperCase() || 'ALL';
        const cursor = decodeCursor<{ queueTime?: string; jobName?: string }>(options.cursor);
        const rows = this.database.prepare(`
            SELECT JOB_NAME, JOB_NAME_SHORT, JOB_NUMBER, JOB_USER, JOB_STATUS,
                   JOB_TYPE, JOB_TYPE_ENHANCED, JOB_QUEUE_NAME, JOB_QUEUE_LIBRARY,
                   JOB_QUEUE_STATUS, JOB_QUEUE_PRIORITY, JOB_QUEUE_TIME,
                   JOB_ENTERED_SYSTEM_TIME, SUBSYSTEM, SUBSYSTEM_LIBRARY_NAME
            FROM queued_job_info
            ORDER BY JOB_QUEUE_TIME, JOB_NAME
        `).all() as unknown as QueuedJobRecord[];
        const filtered = rows
            .filter((job) => !options.queueName?.trim() || job.JOB_QUEUE_NAME === options.queueName.trim())
            .filter((job) => !options.queueLibrary?.trim() || job.JOB_QUEUE_LIBRARY === options.queueLibrary.trim())
            .filter((job) => status === 'ALL' || String(job.JOB_QUEUE_STATUS || '').toUpperCase() === status)
            .filter((job) => matchesSearch([
                job.JOB_NAME,
                job.JOB_NAME_SHORT,
                job.JOB_USER,
                job.JOB_QUEUE_NAME,
                job.JOB_QUEUE_LIBRARY,
                job.SUBSYSTEM
            ], search))
            .filter((job) => !cursor
                || String(job.JOB_QUEUE_TIME || '') > String(cursor.queueTime || '')
                || (
                    String(job.JOB_QUEUE_TIME || '') === String(cursor.queueTime || '')
                    && job.JOB_NAME > String(cursor.jobName || '')
                ));
        const hasMore = filtered.length > limit;
        const data = hasMore ? filtered.slice(0, limit) : filtered;
        const last = data[data.length - 1];

        return {
            data,
            hasMore,
            nextCursor: hasMore && last?.JOB_QUEUE_TIME
                ? encodeCursor({ queueTime: last.JOB_QUEUE_TIME, jobName: last.JOB_NAME })
                : null
        };
    }

    hasQueuedJob(jobName: string) {
        return Boolean(this.database.prepare(
            'SELECT 1 FROM queued_job_info WHERE JOB_NAME = ? LIMIT 1'
        ).get(jobName));
    }

    setJobQueueStatus(queueName: string, queueLibrary: string, status: string) {
        const identity = queueKey(queueName, queueLibrary);
        const normalizedStatus = status.trim().toUpperCase();
        this.jobQueueStatusOverrides.set(identity, normalizedStatus);
        this.database.prepare(`
            UPDATE job_queue_info SET STATUS = ?
            WHERE JOB_QUEUE_NAME = ? AND JOB_QUEUE_LIBRARY = ?
        `).run(normalizedStatus, queueName, queueLibrary);
        this.database.prepare(`
            UPDATE queued_job_info SET JOB_QUEUE_STATUS = ?
            WHERE JOB_QUEUE_NAME = ? AND JOB_QUEUE_LIBRARY = ?
        `).run(normalizedStatus, queueName, queueLibrary);
        this.database.prepare(`
            UPDATE job_info SET JOB_QUEUE_STATUS = ?
            WHERE JOB_QUEUE_NAME = ? AND JOB_QUEUE_LIBRARY = ?
        `).run(normalizedStatus, queueName, queueLibrary);
    }

    setQueuedJobStatus(jobName: string, status: string) {
        const normalizedStatus = status.trim().toUpperCase();
        this.queuedJobStatusOverrides.set(jobName, normalizedStatus);
        this.database.prepare(`
            UPDATE queued_job_info SET JOB_STATUS = ?
            WHERE JOB_NAME = ?
        `).run(normalizedStatus, jobName);
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
