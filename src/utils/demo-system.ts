import * as fs from 'fs/promises';
import * as path from 'path';
import type { ActiveJobRecord, QueryResult } from '../services/ibmi';

interface DemoSnapshotFile extends QueryResult<ActiveJobRecord> {
    generatedAt: string;
    pollCount: number;
}

function randomInt(min: number, max: number) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomFloat(min: number, max: number, digits = 1) {
    const value = min + Math.random() * (max - min);
    return Number(value.toFixed(digits));
}

function createDemoJob(overrides: Partial<ActiveJobRecord>): ActiveJobRecord {
    return {
        JOB_NAME: '000000/DEMO/DEMOJOB',
        JOB_NAME_SHORT: 'DEMOJOB',
        JOB_NUMBER: '000000',
        JOB_USER: 'DEMO',
        SUBSYSTEM: 'QSYSWRK',
        SUBSYSTEM_LIBRARY_NAME: 'QSYS',
        SUBSYSTEM_JOB: 'QSYSWRK/DEMOJOB',
        CURRENT_USER: 'DEMO',
        TYPE: 'BATCH',
        CPU: 0,
        CPU_TIME: 0,
        ELAPSED_CPU_TIME: 0,
        FUNCTION_NAME: 'Demo workload',
        STATUS: 'RUN',
        THREAD_COUNT: 1,
        TEMPORARY_STORAGE: 128,
        TOTAL_DISK_IO_COUNT: 0,
        ELAPSED_TOTAL_DISK_IO_COUNT: 0,
        MESSAGE_REPLY: 'NO',
        DATABASE_LOCK_WAITS: 0,
        DATABASE_LOCK_WAIT_TIME: 0,
        NON_DATABASE_LOCK_WAITS: 0,
        NON_DATABASE_LOCK_WAIT_TIME: 0,
        INTERNAL_MACHINE_LOCK_WAITS: 0,
        INTERNAL_MACHINE_LOCK_WAIT_TIME: 0,
        SQL_STATEMENT_TEXT: 'select * from qsys2.active_job_info fetch first 25 rows only',
        SQL_STATEMENT_STATUS: 'RUNNING',
        SQL_STATEMENT_START_TIMESTAMP: new Date().toISOString(),
        ...overrides
    };
}

export function getDemoDataFilePath(baseDir: string) {
    return path.join(baseDir, 'demo', 'ibm-eye-demo-jobs.json');
}

export function buildDemoSnapshot(pollCount: number): DemoSnapshotFile {
    const now = new Date();
    const msgwActive = pollCount % 4 === 1 || pollCount % 4 === 2;
    const lockWaitActive = pollCount % 5 === 3;
    const highCpuBoost = pollCount % 3 === 0 ? 8 : 0;

    return {
        generatedAt: now.toISOString(),
        pollCount,
        data: [
            createDemoJob({
                JOB_NAME: '738412/QSYSOPR/MSGWJOB',
                JOB_NAME_SHORT: 'MSGWJOB',
                JOB_NUMBER: '738412',
                JOB_USER: 'QSYSOPR',
                SUBSYSTEM: 'QINTER',
                SUBSYSTEM_JOB: 'QINTER/MSGWJOB',
                CURRENT_USER: 'QSYSOPR',
                FUNCTION_NAME: msgwActive ? 'Waiting on operator reply' : 'Interactive order entry',
                STATUS: msgwActive ? 'MSGW' : 'RUN',
                CPU: msgwActive ? randomFloat(0.2, 1.6) : randomFloat(6, 14),
                CPU_TIME: randomInt(1800, 4200),
                ELAPSED_CPU_TIME: msgwActive ? randomInt(120, 340) : randomInt(1400, 2600),
                THREAD_COUNT: 2,
                TEMPORARY_STORAGE: randomInt(260, 420),
                TOTAL_DISK_IO_COUNT: randomInt(12200, 12600),
                ELAPSED_TOTAL_DISK_IO_COUNT: randomInt(180, 260),
                MESSAGE_REPLY: 'YES',
                SQL_STATEMENT_TEXT: msgwActive
                    ? 'call inventory.hold_order_message(?)'
                    : 'select order_id, customer_id from sales.open_orders order by priority desc',
                SQL_STATEMENT_STATUS: msgwActive ? 'WAITING' : 'RUNNING',
                SQL_STATEMENT_START_TIMESTAMP: new Date(now.getTime() - randomInt(35_000, 90_000)).toISOString()
            }),
            createDemoJob({
                JOB_NAME: '552901/BATCHNGT/NIGHTBCH',
                JOB_NAME_SHORT: 'NIGHTBCH',
                JOB_NUMBER: '552901',
                JOB_USER: 'BATCHNGT',
                SUBSYSTEM: 'QBATCH',
                SUBSYSTEM_JOB: 'QBATCH/NIGHTBCH',
                CURRENT_USER: 'BATCHNGT',
                FUNCTION_NAME: 'Posting invoices',
                STATUS: 'RUN',
                CPU: randomFloat(68, 88) + highCpuBoost,
                CPU_TIME: randomInt(14800, 16200),
                ELAPSED_CPU_TIME: randomInt(9800, 11600),
                THREAD_COUNT: 4,
                TEMPORARY_STORAGE: randomInt(760, 920),
                TOTAL_DISK_IO_COUNT: randomInt(228000, 231500),
                ELAPSED_TOTAL_DISK_IO_COUNT: randomInt(1300, 1500),
                SQL_STATEMENT_TEXT: 'merge into finance.daily_invoice_summary using session.posted_batches on ...',
                SQL_STATEMENT_STATUS: 'RUNNING',
                SQL_STATEMENT_START_TIMESTAMP: new Date(now.getTime() - randomInt(120_000, 240_000)).toISOString()
            }),
            createDemoJob({
                JOB_NAME: '441210/APPUSR/LOCKJOB',
                JOB_NAME_SHORT: 'LOCKJOB',
                JOB_NUMBER: '441210',
                JOB_USER: 'APPUSR',
                SUBSYSTEM: 'QHTTPSVR',
                SUBSYSTEM_JOB: 'QHTTPSVR/LOCKJOB',
                CURRENT_USER: 'APPUSR',
                FUNCTION_NAME: lockWaitActive ? 'Waiting on customer row lock' : 'REST API request processing',
                STATUS: lockWaitActive ? 'LCKW' : 'RUN',
                CPU: lockWaitActive ? randomFloat(0.1, 0.8) : randomFloat(14, 24),
                CPU_TIME: randomInt(3200, 5800),
                THREAD_COUNT: 8,
                TEMPORARY_STORAGE: randomInt(420, 610),
                TOTAL_DISK_IO_COUNT: randomInt(67600, 68400),
                ELAPSED_TOTAL_DISK_IO_COUNT: randomInt(320, 420),
                DATABASE_LOCK_WAITS: lockWaitActive ? randomInt(1, 4) : 0,
                DATABASE_LOCK_WAIT_TIME: lockWaitActive ? randomInt(2200, 6800) : 0,
                NON_DATABASE_LOCK_WAITS: 0,
                NON_DATABASE_LOCK_WAIT_TIME: 0,
                INTERNAL_MACHINE_LOCK_WAITS: 0,
                INTERNAL_MACHINE_LOCK_WAIT_TIME: 0,
                SQL_STATEMENT_TEXT: lockWaitActive
                    ? 'update crm.customer set credit_hold = ? where customer_id = ?'
                    : 'select * from api.request_log where status = ? order by created_at desc',
                SQL_STATEMENT_STATUS: lockWaitActive ? 'WAITING' : 'RUNNING',
                SQL_STATEMENT_START_TIMESTAMP: new Date(now.getTime() - randomInt(40_000, 150_000)).toISOString()
            }),
            createDemoJob({
                JOB_NAME: '662204/ETLUSR/ETLPIPE',
                JOB_NAME_SHORT: 'ETLPIPE',
                JOB_NUMBER: '662204',
                JOB_USER: 'ETLUSR',
                SUBSYSTEM: 'QUSRWRK',
                SUBSYSTEM_JOB: 'QUSRWRK/ETLPIPE',
                CURRENT_USER: 'ETLUSR',
                FUNCTION_NAME: pollCount % 6 === 0 ? 'Applying warehouse delta loads' : 'Extracting source records',
                STATUS: pollCount % 6 === 4 ? 'DLYW' : 'RUN',
                CPU: pollCount % 6 === 4 ? randomFloat(0, 0.3) : randomFloat(22, 46),
                CPU_TIME: randomInt(6400, 10800),
                ELAPSED_CPU_TIME: randomInt(5200, 9300),
                THREAD_COUNT: 3,
                TEMPORARY_STORAGE: randomInt(900, 1400),
                TOTAL_DISK_IO_COUNT: randomInt(90200, 94400),
                ELAPSED_TOTAL_DISK_IO_COUNT: randomInt(420, 730),
                SQL_STATEMENT_TEXT: pollCount % 6 === 4
                    ? 'call warehouse.apply_delay_window()'
                    : 'insert into analytics.fact_sales select * from session.fact_delta',
                SQL_STATEMENT_STATUS: pollCount % 6 === 4 ? 'DELAYED' : 'RUNNING',
                SQL_STATEMENT_START_TIMESTAMP: new Date(now.getTime() - randomInt(25_000, 160_000)).toISOString()
            })
        ]
    };
}

export async function writeDemoSnapshot(filePath: string, pollCount: number) {
    const snapshot = buildDemoSnapshot(pollCount);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(snapshot, null, 2), 'utf8');
    return snapshot;
}

export async function readDemoSnapshot(filePath: string): Promise<QueryResult<ActiveJobRecord>> {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<DemoSnapshotFile>;

    return {
        data: Array.isArray(parsed.data) ? parsed.data : []
    };
}
